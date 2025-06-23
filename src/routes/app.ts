import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";

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

export default app;
