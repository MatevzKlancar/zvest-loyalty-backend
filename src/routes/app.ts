import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";
import crypto from "crypto";

const app = new OpenAPIHono();

// Schemas
const scanQRSchema = z.object({
  qr_code_data: z.string().min(1, "QR code data is required"),
  phone_number: z.string().optional(), // For user identification
  email: z.string().email().optional(), // Alternative identification
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
  -H "Content-Type: application/json" \\
  -d '{
    "qr_code_data": "PLT_456e7890-e89b-12d3-a456-426614174111",
    "phone_number": "+1234567890"
  }'
\`\`\`

**Important Notes:**
- Either phone_number or email is required for user identification
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
              phone_number: "+1234567890",
              email: "customer@example.com",
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
    const { qr_code_data, phone_number, email } = c.req.valid("json");

    // Validate that we have either phone or email
    if (!phone_number && !email) {
      return c.json(
        standardResponse(400, "Phone number or email is required"),
        400
      );
    }

    // Parse QR code data (format: PLT_{transaction_id})
    if (!qr_code_data.startsWith("PLT_")) {
      return c.json(standardResponse(400, "Invalid QR code format"), 400);
    }

    const transaction_id = qr_code_data.replace("PLT_", "");

    // Get transaction with shop and loyalty program info
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
          loyalty_programs (
            id,
            type,
            points_per_euro,
            is_active
          )
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
    const loyaltyPrograms = shop.loyalty_programs || [];
    const activeLoyaltyProgram = loyaltyPrograms.find(
      (lp: any) => lp.is_active
    );

    if (!activeLoyaltyProgram) {
      return c.json(
        standardResponse(400, "No active loyalty program for this shop"),
        400
      );
    }

    // Get or create app user
    let appUser;
    const userQuery = supabase.from("app_users").select("*");

    if (phone_number) {
      userQuery.eq("phone_number", phone_number);
    } else {
      userQuery.eq("email", email);
    }

    const { data: existingUser } = await userQuery.single();

    if (existingUser) {
      appUser = existingUser;
    } else {
      // Create new app user
      const { data: newUser, error: userError } = await supabase
        .from("app_users")
        .insert({
          phone_number: phone_number || null,
          email: email || null,
          is_verified: false, // They can verify later
        })
        .select()
        .single();

      if (userError) {
        logger.error("Failed to create app user:", userError);
        return c.json(
          standardResponse(500, "Failed to create user account"),
          500
        );
      }
      appUser = newUser;
    }

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
          loyalty_program_id: activeLoyaltyProgram.id,
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

    // Calculate points to award
    let pointsToAward = 0;
    if (
      activeLoyaltyProgram.type === "points" &&
      activeLoyaltyProgram.points_per_euro
    ) {
      pointsToAward = Math.floor(
        transaction.total_amount * activeLoyaltyProgram.points_per_euro
      );
    }

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
  customer_email: z.string().email("Valid email is required"),
  customer_phone: z.string().optional(),
});

const activatedCouponResponseSchema = z.object({
  activation_id: z.string().uuid(),
  coupon: z.object({
    id: z.string().uuid(),
    code: z.string(),
    type: z.string(),
    value: z.number(),
    discount_percentage: z.number().nullable(),
    description: z.string().nullable(),
    terms_conditions: z.string().nullable(),
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
  activation_code: z.string(),
  activated_at: z.string(),
  expires_at: z.string(),
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
- **Percentage Discount**: Get X% off your next purchase
- **Fixed Amount**: Get $X off your next purchase
- **Free Item**: Get a specific item free
- **Points Multiplier**: Earn bonus points on next purchase

**Example Usage:**
\`\`\`bash
curl -X POST 'https://your-api.com/api/app/coupons/123e4567-e89b-12d3-a456-426614174000/activate' \\
  -H "Content-Type: application/json" \\
  -d '{
    "customer_email": "customer@example.com",
    "customer_phone": "+1234567890"
  }'
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
    body: {
      content: {
        "application/json": {
          schema: activateCouponSchema,
        },
      },
    },
  },
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
    const { customer_email, customer_phone } = c.req.valid("json");

    // Get coupon details and verify it's active and available
    const { data: coupon, error: couponError } = await supabase
      .from("coupons")
      .select(
        `
        id,
        shop_id,
        code,
        type,
        value,
        points_required,
        discount_percentage,
        description,
        terms_conditions,
        expires_at,
        usage_limit,
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

    // Check if coupon usage limit has been reached
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
      return c.json(
        standardResponse(400, "Coupon usage limit has been reached"),
        400
      );
    }

    // Get customer's loyalty account for this shop
    const { data: loyaltyAccount, error: loyaltyError } = await supabase
      .from("customer_loyalty_accounts")
      .select("points_balance, total_points_earned, total_points_redeemed")
      .eq("customer_email", customer_email)
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

    // Generate unique activation code
    const activationCode = `ACT-${coupon.code}-${Date.now()}`;
    const activationId = crypto.randomUUID();
    const activatedAt = new Date().toISOString();

    // Set expiration for activated coupon (default 30 days or coupon's expiry, whichever is sooner)
    const defaultExpiryDays = 30;
    const defaultExpiry = new Date();
    defaultExpiry.setDate(defaultExpiry.getDate() + defaultExpiryDays);

    const activationExpiry = coupon.expires_at
      ? new Date(coupon.expires_at) < defaultExpiry
        ? coupon.expires_at
        : defaultExpiry.toISOString()
      : defaultExpiry.toISOString();

    try {
      // Begin transaction operations

      // 1. Deduct points from loyalty account
      const { error: pointsError } = await supabase
        .from("customer_loyalty_accounts")
        .update({
          points_balance: loyaltyAccount.points_balance - requiredPoints,
          total_points_redeemed:
            loyaltyAccount.total_points_redeemed + requiredPoints,
          updated_at: activatedAt,
        })
        .eq("customer_email", customer_email)
        .eq("shop_id", coupon.shop_id);

      if (pointsError) {
        throw new Error(`Failed to deduct points: ${pointsError.message}`);
      }

      // 2. Create coupon activation record
      const { error: activationError } = await supabase
        .from("coupon_activations")
        .insert({
          id: activationId,
          coupon_id: couponId,
          shop_id: coupon.shop_id,
          customer_email: customer_email,
          customer_phone: customer_phone,
          activation_code: activationCode,
          points_redeemed: requiredPoints,
          activated_at: activatedAt,
          expires_at: activationExpiry,
          status: "active",
        });

      if (activationError) {
        // Rollback points deduction
        await supabase
          .from("customer_loyalty_accounts")
          .update({
            points_balance: loyaltyAccount.points_balance,
            total_points_redeemed: loyaltyAccount.total_points_redeemed,
          })
          .eq("customer_email", customer_email)
          .eq("shop_id", coupon.shop_id);

        throw new Error(
          `Failed to create activation record: ${activationError.message}`
        );
      }

      // 3. Update coupon usage count
      await supabase
        .from("coupons")
        .update({
          used_count: coupon.used_count + 1,
          updated_at: activatedAt,
        })
        .eq("id", couponId);

      // 4. Create transaction record for points redemption
      await supabase.from("transactions").insert({
        shop_id: coupon.shop_id,
        customer_email: customer_email,
        total_amount: 0, // No monetary transaction
        loyalty_points_awarded: 0,
        loyalty_points_redeemed: requiredPoints,
        status: "completed",
        transaction_type: "coupon_redemption",
        pos_invoice_id: `COUPON-${activationCode}`,
        metadata: {
          coupon_id: couponId,
          activation_id: activationId,
          activation_code: activationCode,
        },
      });

      // Generate usage instructions based on coupon type
      let usageInstructions =
        "Present this activation code to the cashier when making your purchase.";

      switch (coupon.type) {
        case "percentage":
          usageInstructions = `Show this code to get ${
            coupon.discount_percentage
          }% off your purchase. ${coupon.terms_conditions || ""}`;
          break;
        case "fixed":
          usageInstructions = `Show this code to get $${
            coupon.value
          } off your purchase. ${coupon.terms_conditions || ""}`;
          break;
        case "free_item":
          usageInstructions = `Show this code to get your free item. ${
            coupon.description || ""
          } ${coupon.terms_conditions || ""}`;
          break;
        case "points_multiplier":
          usageInstructions = `Show this code to earn ${
            coupon.value
          }x points on your next purchase. ${coupon.terms_conditions || ""}`;
          break;
      }

      const shop = coupon.shops as any;
      const activationData = {
        activation_id: activationId,
        coupon: {
          id: coupon.id,
          code: coupon.code,
          type: coupon.type,
          value: coupon.value,
          discount_percentage: coupon.discount_percentage,
          description: coupon.description,
          terms_conditions: coupon.terms_conditions,
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
        activation_code: activationCode,
        activated_at: activatedAt,
        expires_at: activationExpiry,
        usage_instructions: usageInstructions,
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
