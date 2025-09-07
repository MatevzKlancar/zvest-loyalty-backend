import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";
import crypto from "crypto";
import {
  generateUniqueRedemptionCode,
  formatRedemptionCodeForDisplay,
} from "../utils/redemption-code";
import {
  authenticateUser,
  requireCustomer,
  UnifiedAuthContext,
} from "../middleware/unified-auth";

const app = new OpenAPIHono<UnifiedAuthContext>();

// Apply authentication to all app routes - customers must be logged in
app.use("*", authenticateUser);
app.use("*", requireCustomer);

// Schemas
const scanQRSchema = z.object({
  qr_code_data: z.string().min(1, "QR code data is required"),
});

const transactionDetailsSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  pos_invoice_id: z.string(),
  total_amount: z.number(),
  tax_amount: z.number(),
  items: z.array(z.any()),
  loyalty_points_awarded: z.number(),
  status: z.string(),
  qr_scanned_at: z.string().nullable(),
  created_at: z.string(),
  shop: z.object({
    name: z.string(),
    type: z.string().nullable(),
  }),
});

const scanResultSchema = z.object({
  transaction: transactionDetailsSchema,
  points_awarded: z.number(),
  message: z.string(),
  loyalty_account: z
    .object({
      points_balance: z.number(),
      total_spent: z.number(),
    })
    .optional(),
});

// Step 6: Scan QR code and redeem points
const scanQRRoute = createRoute({
  method: "post",
  path: "/scan-qr",
  summary: "Scan QR code for points",
  description: `
Scans a QR code from a receipt and awards loyalty points to the customer. This is the final step in the loyalty flow where customers earn rewards.

**How it Works:**
1. Customer receives receipt with QR code after purchase
2. Customer opens mobile app and scans QR code
3. System validates QR code and calculates points
4. Points are awarded to customer's loyalty account
5. Customer receives confirmation with updated balance

**Points Calculation:**
Points are calculated based on the shop's loyalty program settings. For example:
- Default: 10 points per €1 spent
- Premium shops: Up to 50 points per €1
- Bonus campaigns: Additional multipliers possible

**QR Code Format:**
QR codes follow the format \`PLT_{transaction_id}\` and are single-use only.

**Example Usage:**
\`\`\`bash
curl -X POST https://zvest-loyalty-backend.onrender.com/api/app/scan-qr \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "qr_code_data": "PLT_456e7890-e89b-12d3-a456-426614174111"
  }'
\`\`\`

**Important Notes:**
- User must be authenticated to scan QR codes
- QR codes can only be scanned once
- QR codes expire after 30 days
- Points are awarded instantly upon successful scan
  `,
  tags: ["Customer App"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: scanQRSchema.openapi({
            example: {
              qr_code_data: "PLT_456e7890-e89b-12d3-a456-426614174111",
            },
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "QR code scanned successfully, points awarded",
      content: {
        "application/json": {
          schema: z
            .object({
              success: z.boolean(),
              message: z.string(),
              data: scanResultSchema,
            })
            .openapi({
              example: {
                success: true,
                message: "Points awarded successfully!",
                data: {
                  transaction: {
                    id: "456e7890-e89b-12d3-a456-426614174111",
                    shop_id: "123e4567-e89b-12d3-a456-426614174000",
                    pos_invoice_id: "INV-2024-001",
                    total_amount: 15.5,
                    tax_amount: 2.5,
                    items: [
                      {
                        name: "Caffe Latte",
                        quantity: 2,
                        unit_price: 4.5,
                      },
                    ],
                    loyalty_points_awarded: 155,
                    status: "completed",
                    qr_scanned_at: "2024-01-15T15:30:00Z",
                    created_at: "2024-01-15T14:25:00Z",
                    shop: {
                      name: "Coffee House Downtown",
                      type: "coffee",
                    },
                  },
                  points_awarded: 155,
                  message: "You earned 155 points from Coffee House Downtown!",
                  loyalty_account: {
                    points_balance: 1250,
                    total_spent: 125.75,
                  },
                },
              },
            }),
        },
      },
    },
    400: {
      description: "Invalid or already used QR code",
      content: {
        "application/json": {
          schema: z
            .object({
              success: z.boolean().default(false),
              message: z.string(),
            })
            .openapi({
              example: {
                success: false,
                message: "QR code has already been used",
              },
            }),
        },
      },
    },
    404: {
      description: "QR code not found or invalid",
      content: {
        "application/json": {
          schema: z
            .object({
              success: z.boolean().default(false),
              message: z.string(),
            })
            .openapi({
              example: {
                success: false,
                message: "Transaction not found or invalid QR code",
              },
            }),
        },
      },
    },
  },
});

app.openapi(scanQRRoute, async (c) => {
  try {
    const { qr_code_data } = c.req.valid("json");
    const appUser = c.get("appUser"); // Get authenticated customer

    // Parse QR code data (format: PLT_{transaction_id})
    if (!qr_code_data.startsWith("PLT_")) {
      return c.json(standardResponse(400, "Invalid QR code format"), 400);
    }

    const transaction_id = qr_code_data.replace("PLT_", "");

    // Get transaction with shop info
    const { data: transaction, error: transactionError } = await supabase
      .from("transactions")
      .select(
        `
        id,
        shop_id,
        pos_invoice_id,
        total_amount,
        tax_amount,
        items,
        loyalty_points_awarded,
        status,
        qr_scanned_at,
        created_at,
        shops (
          name,
          type,
          loyalty_type,
          points_per_euro
        )
      `
      )
      .eq("id", transaction_id)
      .eq("qr_code_data", qr_code_data)
      .single();

    if (transactionError || !transaction) {
      return c.json(
        standardResponse(404, "Transaction not found or invalid QR code"),
        404
      );
    }

    // Check if QR code was already scanned
    if (transaction.qr_scanned_at) {
      return c.json(
        standardResponse(400, "QR code has already been used"),
        400
      );
    }

    // Check if transaction is in correct status
    if (transaction.status !== "pending") {
      return c.json(
        standardResponse(400, "Transaction is not eligible for points"),
        400
      );
    }

    const shop = transaction.shops as any;

    // Check if shop supports points (MVP only supports points)
    if (shop.loyalty_type !== "points") {
      return c.json(
        standardResponse(400, "Shop does not support points loyalty system"),
        400
      );
    }

    if (!shop.points_per_euro || shop.points_per_euro <= 0) {
      return c.json(
        standardResponse(400, "Shop has invalid points configuration"),
        400
      );
    }

    // User is already authenticated via middleware

    // Get or create loyalty account
    let loyaltyAccount;
    const { data: existingAccount } = await supabase
      .from("customer_loyalty_accounts")
      .select("*")
      .eq("app_user_id", appUser.id)
      .eq("shop_id", transaction.shop_id)
      .single();

    if (existingAccount) {
      loyaltyAccount = existingAccount;
    } else {
      // Create new loyalty account
      const { data: newAccount, error: accountError } = await supabase
        .from("customer_loyalty_accounts")
        .insert({
          app_user_id: appUser.id,
          shop_id: transaction.shop_id,
        })
        .select()
        .single();

      if (accountError) {
        logger.error("Failed to create loyalty account:", accountError);
        return c.json(
          standardResponse(500, "Failed to create loyalty account"),
          500
        );
      }
      loyaltyAccount = newAccount;
    }

    // Calculate points to award (using shop's points_per_euro)
    const pointsToAward = Math.floor(
      transaction.total_amount * shop.points_per_euro
    );

    // Update transaction as scanned and award points
    const { error: updateTransactionError } = await supabase
      .from("transactions")
      .update({
        app_user_id: appUser.id,
        loyalty_account_id: loyaltyAccount.id,
        loyalty_points_awarded: pointsToAward,
        qr_scanned_at: new Date().toISOString(),
        status: "completed",
      })
      .eq("id", transaction_id);

    if (updateTransactionError) {
      logger.error("Failed to update transaction:", updateTransactionError);
      return c.json(
        standardResponse(500, "Failed to process transaction"),
        500
      );
    }

    // Update loyalty account with new points and spending
    const { data: updatedAccount, error: updateAccountError } = await supabase
      .from("customer_loyalty_accounts")
      .update({
        points_balance: loyaltyAccount.points_balance + pointsToAward,
        total_spent: loyaltyAccount.total_spent + transaction.total_amount,
        invoice_count: (loyaltyAccount.invoice_count || 0) + 1,
        last_visit_at: new Date().toISOString(),
      })
      .eq("id", loyaltyAccount.id)
      .select()
      .single();

    if (updateAccountError) {
      logger.error("Failed to update loyalty account:", updateAccountError);
      // Note: Transaction was already updated, so we continue
    }

    // Log the action
    await supabase.from("transaction_logs").insert({
      transaction_id,
      action: "qr_scanned",
      details: {
        points_awarded: pointsToAward,
        app_user_id: appUser.id,
        loyalty_account_id: loyaltyAccount.id,
      },
      performed_by: `app_user_${appUser.id}`,
    });

    const result = {
      transaction: {
        ...transaction,
        qr_scanned_at: new Date().toISOString(),
        loyalty_points_awarded: pointsToAward,
        status: "completed",
        shop: {
          name: shop.name,
          type: shop.type,
        },
      },
      points_awarded: pointsToAward,
      message: `Congratulations! You earned ${pointsToAward} points.`,
      loyalty_account: {
        points_balance:
          updatedAccount?.points_balance ||
          loyaltyAccount.points_balance + pointsToAward,
        total_spent:
          updatedAccount?.total_spent ||
          loyaltyAccount.total_spent + transaction.total_amount,
      },
    };

    logger.info(
      `QR code scanned successfully: ${transaction_id}, points awarded: ${pointsToAward}`
    );
    return c.json(standardResponse(200, "Points awarded successfully", result));
  } catch (error) {
    logger.error("Error scanning QR code:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get transaction details (for app users to see their transaction history)
const getTransactionRoute = createRoute({
  method: "get",
  path: "/transactions/{transaction_id}",
  summary: "Get transaction details",
  description: "Gets detailed information about a specific transaction",
  tags: ["Customer App"],
  request: {
    params: z.object({
      transaction_id: z.string().uuid("Invalid transaction ID"),
    }),
  },
  responses: {
    200: {
      description: "Transaction details retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: transactionDetailsSchema,
          }),
        },
      },
    },
  },
});

app.openapi(getTransactionRoute, async (c) => {
  try {
    const { transaction_id } = c.req.valid("param");

    const { data: transaction, error } = await supabase
      .from("transactions")
      .select(
        `
        id,
        shop_id,
        pos_invoice_id,
        total_amount,
        tax_amount,
        items,
        loyalty_points_awarded,
        status,
        qr_scanned_at,
        created_at,
        shops (
          name,
          type
        )
      `
      )
      .eq("id", transaction_id)
      .single();

    if (error || !transaction) {
      return c.json(standardResponse(404, "Transaction not found"), 404);
    }

    return c.json(
      standardResponse(
        200,
        "Transaction details retrieved successfully",
        transaction
      )
    );
  } catch (error) {
    logger.error("Error getting transaction details:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// ===========================
// COUPON ACTIVATION ENDPOINT
// ===========================

const activateCouponSchema = z.object({
  // No fields needed - customer identified from authenticated JWT token
});

const activatedCouponResponseSchema = z.object({
  redemption_id: z.string(),
  coupon: z.object({
    id: z.string().uuid(),
    type: z.string(),
    articles_data: z.array(z.any()),
    name: z.string().nullable(),
    description: z.string().nullable(),
    expires_at: z.string().nullable(),
  }),
  shop: z.object({
    id: z.string().uuid(),
    name: z.string(),
    type: z.string().nullable(),
  }),
  customer: z.object({
    email: z.string(),
    phone: z.string().nullable(),
    points_balance_before: z.number(),
    points_balance_after: z.number(),
    points_redeemed: z.number(),
  }),
  redeemed_at: z.string(),
  expires_at: z.string(),
  valid_for_minutes: z.number(),
  usage_instructions: z.string(),
});

// ===========================
// POST /coupons/:couponId/activate - Activate a coupon
// ===========================

const activateCouponRoute = createRoute({
  method: "post",
  path: "/coupons/{couponId}/activate",
  summary: "🎟️ Activate a coupon",
  description: `
Activate a coupon by redeeming loyalty points. This converts points into a usable discount coupon.

**How it Works:**
1. Customer selects a coupon they want to redeem
2. System checks if customer has enough points
3. Points are deducted from customer's loyalty account
4. Unique activation code is generated for the coupon
5. Customer receives activation details and usage instructions

**Coupon Types Supported:**
- **Percentage Discount**: Get X% off your next purchase (100% = free item)
- **Fixed Amount**: Get €X off your next purchase

**Example Usage:**
\`\`\`bash
curl -X POST 'https://your-api.com/api/app/coupons/123e4567-e89b-12d3-a456-426614174000/activate' \\
  -H "Authorization: Bearer CUSTOMER_JWT_TOKEN" \\
  -H "Content-Type: application/json"
\`\`\`

**Use Cases:**
- Redeem rewards in customer mobile app
- Convert loyalty points to discounts
- Generate single-use coupon codes
- Manage customer reward redemptions
  `,
  tags: ["Customer App"],
  request: {
    params: z.object({
      couponId: z.string().uuid("Invalid coupon ID"),
    }),
  },
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Coupon activated successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: activatedCouponResponseSchema,
          }),
        },
      },
    },
    400: {
      description: "Insufficient points or invalid coupon",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string(),
            data: z
              .object({
                required_points: z.number().optional(),
                current_points: z.number().optional(),
                points_needed: z.number().optional(),
              })
              .optional(),
          }),
        },
      },
    },
    404: {
      description: "Coupon not found or not available",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("Coupon not found or not available"),
          }),
        },
      },
    },
  },
});

app.openapi(activateCouponRoute, async (c) => {
  try {
    const { couponId } = c.req.valid("param");
    const appUser = c.get("appUser"); // Get authenticated customer
    const customer_email = appUser.email;
    const customer_phone = appUser.phone_number;

    // Get coupon details and verify it's active and available
    const { data: coupon, error: couponError } = await supabase
      .from("coupons")
      .select(
        `
        id,
        shop_id,
        type,
        articles_data,
        points_required,
        name,
        description,
        expires_at,
        used_count,
        is_active,
        shops!inner (
          id,
          name,
          type,
          status
        )
      `
      )
      .eq("id", couponId)
      .eq("is_active", true)
      .eq("shops.status", "active")
      .single();

    if (couponError || !coupon) {
      return c.json(
        standardResponse(404, "Coupon not found or not available"),
        404
      );
    }

    // Check if coupon has expired
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return c.json(standardResponse(400, "Coupon has expired"), 400);
    }

    // Get customer loyalty account for this shop (appUser is already authenticated)
    const { data: loyaltyAccount, error: loyaltyError } = await supabase
      .from("customer_loyalty_accounts")
      .select("points_balance, total_points_earned, total_points_redeemed")
      .eq("app_user_id", appUser.id)
      .eq("shop_id", coupon.shop_id)
      .single();

    if (loyaltyError || !loyaltyAccount) {
      return c.json(
        standardResponse(
          400,
          "Customer does not have a loyalty account for this store"
        ),
        400
      );
    }

    // Check if customer has enough points
    const requiredPoints = coupon.points_required || 0;
    if (loyaltyAccount.points_balance < requiredPoints) {
      return c.json(
        standardResponse(400, "Insufficient loyalty points", {
          required_points: requiredPoints,
          current_points: loyaltyAccount.points_balance,
          points_needed: requiredPoints - loyaltyAccount.points_balance,
        }),
        400
      );
    }

    // Generate unique redemption code (server-side)
    const codeResult = await generateUniqueRedemptionCode(10);

    if (!codeResult.success) {
      logger.error(
        "Failed to generate unique redemption code:",
        codeResult.error
      );
      return c.json(
        standardResponse(500, "Failed to generate redemption code"),
        500
      );
    }

    const humanReadableCode = codeResult.code;
    // Generate UUID for the database record
    const redemptionId = crypto.randomUUID();

    const redeemedAt = new Date().toISOString();

    // Set expiration for activated coupon (5 minutes from activation)
    const expiryTime = new Date();
    expiryTime.setMinutes(expiryTime.getMinutes() + 5);
    const redemptionExpiry = expiryTime.toISOString();

    try {
      // Begin transaction operations

      // 1. Deduct points from loyalty account
      const { error: pointsError } = await supabase
        .from("customer_loyalty_accounts")
        .update({
          points_balance: loyaltyAccount.points_balance - requiredPoints,
          total_points_redeemed:
            loyaltyAccount.total_points_redeemed + requiredPoints,
          updated_at: redeemedAt,
        })
        .eq("app_user_id", appUser.id)
        .eq("shop_id", coupon.shop_id);

      if (pointsError) {
        throw new Error(`Failed to deduct points: ${pointsError.message}`);
      }

      // 2. Create coupon redemption record
      const { error: redemptionError } = await supabase
        .from("coupon_redemptions")
        .insert({
          id: redemptionId,
          redemption_code: humanReadableCode, // Store the 6-digit code
          coupon_id: couponId,
          app_user_id: appUser.id,
          points_deducted: requiredPoints,
          redeemed_at: redeemedAt,
          status: "active",
        });

      if (redemptionError) {
        // Rollback points deduction
        await supabase
          .from("customer_loyalty_accounts")
          .update({
            points_balance: loyaltyAccount.points_balance,
            total_points_redeemed: loyaltyAccount.total_points_redeemed,
          })
          .eq("app_user_id", appUser.id)
          .eq("shop_id", coupon.shop_id);

        throw new Error(
          `Failed to create redemption record: ${redemptionError.message}`
        );
      }

      // 3. Create transaction record for points redemption
      await supabase.from("transactions").insert({
        shop_id: coupon.shop_id,
        app_user_id: appUser.id,
        pos_invoice_id: `COUPON-REDEEM-${redemptionId}`,
        total_amount: 0, // No monetary transaction
        tax_amount: 0,
        items: [],
        loyalty_points_awarded: 0,
        status: "completed",
        metadata: {
          type: "coupon_redemption",
          coupon_id: couponId,
          redemption_id: redemptionId,
          points_deducted: requiredPoints,
        },
      });

      // Generate usage instructions based on coupon type and articles_data
      let usageInstructions =
        "Present this QR code to the cashier when making your purchase.";

      try {
        const articlesData = coupon.articles_data as any[];
        if (articlesData && articlesData.length > 0) {
          const firstArticle = articlesData[0];

          switch (coupon.type) {
            case "percentage":
              if (firstArticle.discount_value === 100) {
                usageInstructions = `Show this QR code to get a free ${
                  firstArticle.article_name || "item"
                }.`;
              } else {
                usageInstructions = `Show this QR code to get ${firstArticle.discount_value}% off your purchase.`;
              }
              break;
            case "fixed":
              usageInstructions = `Show this QR code to get €${firstArticle.discount_value} off your purchase.`;
              break;
          }
        }
      } catch (error) {
        logger.warn(
          "Error parsing articles_data for coupon instructions:",
          error
        );
      }

      const shop = coupon.shops as any;
      const displayCode = formatRedemptionCodeForDisplay(humanReadableCode);

      const activationData = {
        redemption_id: redemptionId,
        redemption_code: humanReadableCode, // Raw 6-digit code for POS systems
        display_code: displayCode, // Formatted code for frontend display (123-456)
        qr_code_data: humanReadableCode, // QR code contains the raw 6-digit code
        coupon: {
          id: coupon.id,
          type: coupon.type,
          articles_data: coupon.articles_data,
          name: coupon.name,
          description: coupon.description,
          expires_at: coupon.expires_at,
        },
        shop: {
          id: coupon.shop_id,
          name: shop.name,
          type: shop.type,
        },
        customer: {
          email: customer_email,
          phone: customer_phone,
          points_balance_before: loyaltyAccount.points_balance,
          points_balance_after: loyaltyAccount.points_balance - requiredPoints,
          points_redeemed: requiredPoints,
        },
        redeemed_at: redeemedAt,
        expires_at: redemptionExpiry,
        valid_for_minutes: 5,
        usage_instructions: `Show QR code or tell staff: "${displayCode}" - Valid for 5 minutes`,
      };

      return c.json(
        standardResponse(200, "Coupon activated successfully", activationData)
      );
    } catch (error) {
      logger.error("Error during coupon activation:", error);
      return c.json(standardResponse(500, "Failed to activate coupon"), 500);
    }
  } catch (error) {
    logger.error("Error activating coupon:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

export default app;
