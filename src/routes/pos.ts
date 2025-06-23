import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { authenticatePOSProvider, type AuthContext } from "../middleware/auth";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";

const pos = new OpenAPIHono<AuthContext>();

// Apply authentication middleware to all routes
pos.use("*", authenticatePOSProvider);

// Schemas
const enableShopSchema = z.object({
  pos_shop_id: z.string().min(1, "POS shop ID is required"),
  pos_data: z.record(z.any()).optional(), // Any POS-specific data
});

const syncArticlesSchema = z.object({
  articles: z.array(
    z.object({
      pos_article_id: z.string(),
      name: z.string(),
      base_price: z.number().min(0), // Default/fallback price
      description: z.string().optional(),
      category: z.string().optional(),
      type: z.string().optional(),
      tax_type: z.string().optional(),
      tax_rate: z.number().optional(),
      is_coupon_eligible: z.boolean().optional().default(true),
      // Time-based pricing rules (optional)
      pricing_rules: z
        .array(
          z.object({
            name: z.string().optional(), // e.g., "Happy Hour", "Morning Special"
            price: z.number().min(0),
            start_time: z.string().optional(), // "08:00" format
            end_time: z.string().optional(), // "10:00" format
            start_date: z.string().optional(), // "2024-01-01" format
            end_date: z.string().optional(), // "2024-12-31" format
            days_of_week: z.array(z.number().min(1).max(7)).optional(), // [1,2,3,4,5] for Mon-Fri
            priority: z.number().optional().default(0),
            description: z.string().optional(),
          })
        )
        .optional()
        .default([]),
    })
  ),
});

const createTransactionSchema = z.object({
  shop_id: z.string().uuid("Invalid shop ID"),
  pos_invoice_id: z.string().min(1, "POS invoice ID is required"),
  total_amount: z.number().min(0, "Total amount must be positive"),
  tax_amount: z.number().min(0).optional(),
  items: z.array(
    z.object({
      pos_article_id: z.string(),
      name: z.string(),
      quantity: z.number().min(0),
      unit_price: z.number().min(0),
      total_price: z.number().min(0),
      tax_rate: z.number().optional(),
    })
  ),
  metadata: z.record(z.any()).optional(),
});

const shopResponseSchema = z.object({
  id: z.string().uuid(),
  pos_shop_id: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.string().nullable(),
  status: z.string(),
  pos_synced_at: z.string().nullable(),
  created_at: z.string(),
});

const transactionResponseSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  pos_invoice_id: z.string(),
  total_amount: z.number(),
  status: z.string(),
  qr_code_data: z.string(),
  created_at: z.string(),
});

const qrDataResponseSchema = z.object({
  qr_code_data: z.string(),
  display_text: z.string(),
  transaction_id: z.string().uuid(),
  shop_name: z.string(),
  total_amount: z.number(),
});

// Step 2 & 3: Get all shops for POS provider
const getShopsRoute = createRoute({
  method: "get",
  path: "/shops",
  summary: "Get all shops for POS provider",
  description: "Returns all shops that this POS provider should integrate with",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  responses: {
    200: {
      description: "Shops retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(shopResponseSchema),
          }),
        },
      },
    },
  },
});

pos.openapi(getShopsRoute, async (c) => {
  try {
    const posProvider = c.get("posProvider");

    // Get shops that belong to this POS provider
    const { data: shops, error } = await supabase
      .from("shops")
      .select(
        `
        id,
        pos_shop_id,
        name,
        description,
        type,
        status,
        pos_synced_at,
        created_at
      `
      )
      .eq("pos_provider_id", posProvider.id)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      logger.error("Failed to fetch shops:", error);
      return c.json(standardResponse(500, "Failed to fetch shops"), 500);
    }

    logger.info(
      `Retrieved ${shops.length} shops for provider: ${posProvider.id}`
    );
    return c.json(standardResponse(200, "Shops retrieved successfully", shops));
  } catch (error) {
    logger.error("Error fetching shops:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Step 2: Enable shop in POS system
const enableShopRoute = createRoute({
  method: "post",
  path: "/shops/{shop_id}/enable",
  summary: "Enable shop in POS system",
  description: "Activates a shop and connects it to the POS system",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({
      shop_id: z.string().uuid("Invalid shop ID"),
    }),
    body: {
      content: {
        "application/json": {
          schema: enableShopSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Shop enabled successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: shopResponseSchema,
          }),
        },
      },
    },
  },
});

pos.openapi(enableShopRoute, async (c) => {
  try {
    const { shop_id } = c.req.valid("param");
    const enableData = c.req.valid("json");
    const posProvider = c.get("posProvider");

    // Verify shop belongs to this POS provider
    const { data: existingShop, error: shopError } = await supabase
      .from("shops")
      .select("*")
      .eq("id", shop_id)
      .eq("pos_provider_id", posProvider.id)
      .single();

    if (shopError || !existingShop) {
      return c.json(
        standardResponse(404, "Shop not found or access denied"),
        404
      );
    }

    // Check if pos_shop_id is already used by another shop
    if (enableData.pos_shop_id) {
      const { data: duplicateShop } = await supabase
        .from("shops")
        .select("id")
        .eq("pos_provider_id", posProvider.id)
        .eq("pos_shop_id", enableData.pos_shop_id)
        .neq("id", shop_id)
        .single();

      if (duplicateShop) {
        return c.json(standardResponse(400, "POS shop ID already in use"), 400);
      }
    }

    // Update shop to active status
    const { data: shop, error } = await supabase
      .from("shops")
      .update({
        pos_shop_id: enableData.pos_shop_id,
        status: "active",
        pos_synced_at: new Date().toISOString(),
        pos_sync_data: enableData.pos_data || {},
      })
      .eq("id", shop_id)
      .select()
      .single();

    if (error) {
      logger.error("Failed to enable shop:", error);
      return c.json(standardResponse(500, "Failed to enable shop"), 500);
    }

    logger.info(`Shop enabled successfully: ${shop_id}`);
    return c.json(standardResponse(200, "Shop enabled successfully", shop));
  } catch (error) {
    logger.error("Error enabling shop:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Step 2: Sync articles/menu for shop
const syncArticlesRoute = createRoute({
  method: "post",
  path: "/shops/{shop_id}/articles",
  summary: "Sync shop articles/menu",
  description: "Updates the shop's menu/articles from POS system",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({
      shop_id: z.string().uuid("Invalid shop ID"),
    }),
    body: {
      content: {
        "application/json": {
          schema: syncArticlesSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Articles synced successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              synced_count: z.number(),
            }),
          }),
        },
      },
    },
  },
});

pos.openapi(syncArticlesRoute, async (c) => {
  try {
    const { shop_id } = c.req.valid("param");
    const { articles } = c.req.valid("json");
    const posProvider = c.get("posProvider");

    // Verify shop belongs to POS provider and is active
    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .select("id, status")
      .eq("id", shop_id)
      .eq("pos_provider_id", posProvider.id)
      .eq("status", "active")
      .single();

    if (shopError || !shop) {
      return c.json(
        standardResponse(404, "Shop not found, inactive, or access denied"),
        404
      );
    }

    // Delete existing articles for this shop
    const { error: deleteError } = await supabase
      .from("articles")
      .delete()
      .eq("shop_id", shop_id);

    if (deleteError) {
      logger.error("Failed to delete existing articles:", deleteError);
      return c.json(standardResponse(500, "Failed to sync articles"), 500);
    }

    // Insert new articles and their pricing rules
    if (articles.length > 0) {
      const articleInserts = articles.map((article) => ({
        shop_id,
        pos_article_id: article.pos_article_id,
        name: article.name,
        base_price: article.base_price,
        description: article.description || null,
        category: article.category || null,
        type: article.type || null,
        tax_type: article.tax_type || null,
        tax_rate: article.tax_rate || 0,
        is_coupon_eligible: article.is_coupon_eligible ?? true,
      }));

      const { data: insertedArticles, error: insertError } = await supabase
        .from("articles")
        .insert(articleInserts)
        .select("id, pos_article_id");

      if (insertError) {
        logger.error("Failed to insert new articles:", insertError);
        return c.json(standardResponse(500, "Failed to sync articles"), 500);
      }

      // Insert pricing rules for articles that have them
      const pricingRuleInserts: any[] = [];
      for (const article of articles) {
        if (article.pricing_rules && article.pricing_rules.length > 0) {
          const articleId = insertedArticles.find(
            (a) => a.pos_article_id === article.pos_article_id
          )?.id;

          if (articleId) {
            for (const rule of article.pricing_rules) {
              pricingRuleInserts.push({
                article_id: articleId,
                name: rule.name || null,
                price: rule.price,
                start_time: rule.start_time || null,
                end_time: rule.end_time || null,
                start_date: rule.start_date || null,
                end_date: rule.end_date || null,
                days_of_week: rule.days_of_week || null,
                priority: rule.priority || 0,
                description: rule.description || null,
              });
            }
          }
        }
      }

      // Insert pricing rules if any exist
      if (pricingRuleInserts.length > 0) {
        const { error: pricingError } = await supabase
          .from("article_pricing")
          .insert(pricingRuleInserts);

        if (pricingError) {
          logger.error("Failed to insert pricing rules:", pricingError);
          // Don't fail the entire sync, just log the error
          logger.warn("Continuing sync without pricing rules");
        }
      }
    }

    logger.info(`Synced ${articles.length} articles for shop: ${shop_id}`);
    return c.json(
      standardResponse(200, "Articles synced successfully", {
        synced_count: articles.length,
      })
    );
  } catch (error) {
    logger.error("Error syncing articles:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Step 4: Create transaction from POS terminal
const createTransactionRoute = createRoute({
  method: "post",
  path: "/transactions",
  summary: "Create transaction from POS",
  description: `
Creates a new transaction in the loyalty platform and automatically generates a QR code for the receipt. This is the core endpoint for POS integration.

**Process Flow:**
1. POS system processes a sale
2. POS calls this endpoint with transaction details
3. System generates unique QR code
4. QR code is displayed on receipt
5. Customer scans QR to earn points

**QR Code Format:**
The generated QR code follows the format \`PLT_{transaction_id}\` and is designed for one-time use.

**Example Usage:**
\`\`\`bash
curl -X POST https://api.zvest.com/api/pos/transactions \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: your-api-key" \\
  -d '{
    "shop_id": "shop-uuid",
    "pos_invoice_id": "INV-2024-001",
    "total_amount": 15.50,
    "items": [...]
  }'
\`\`\`

**Important Notes:**
- Each transaction generates a unique QR code
- QR codes expire after 30 days if not scanned
- Only transactions with status 'pending' can award points
  `,
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createTransactionSchema.openapi({
            example: {
              shop_id: "123e4567-e89b-12d3-a456-426614174000",
              pos_invoice_id: "INV-2024-001",
              total_amount: 15.5,
              tax_amount: 2.5,
              items: [
                {
                  pos_article_id: "coffee-latte",
                  name: "Caffe Latte",
                  quantity: 2,
                  unit_price: 4.5,
                  total_price: 9.0,
                  tax_rate: 0.21,
                },
              ],
              metadata: {
                payment_method: "card",
                table_number: "12",
              },
            },
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Transaction created successfully with QR code",
      content: {
        "application/json": {
          schema: z
            .object({
              success: z.boolean(),
              message: z.string(),
              data: transactionResponseSchema,
            })
            .openapi({
              example: {
                success: true,
                message: "Transaction created successfully",
                data: {
                  id: "456e7890-e89b-12d3-a456-426614174111",
                  shop_id: "123e4567-e89b-12d3-a456-426614174000",
                  pos_invoice_id: "INV-2024-001",
                  total_amount: 15.5,
                  status: "pending",
                  qr_code_data: "PLT_456e7890-e89b-12d3-a456-426614174111",
                  created_at: "2024-01-15T14:25:00Z",
                },
              },
            }),
        },
      },
    },
    400: {
      description: "Invalid request parameters",
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
                message: "Shop not found or not enabled",
              },
            }),
        },
      },
    },
    401: {
      description: "Invalid API key",
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
                message: "Invalid API key",
              },
            }),
        },
      },
    },
  },
});

pos.openapi(createTransactionRoute, async (c) => {
  try {
    const transactionData = c.req.valid("json");
    const posProvider = c.get("posProvider");

    // Verify shop belongs to POS provider and is active
    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .select("id, name")
      .eq("id", transactionData.shop_id)
      .eq("pos_provider_id", posProvider.id)
      .eq("status", "active")
      .single();

    if (shopError || !shop) {
      return c.json(
        standardResponse(404, "Shop not found, inactive, or access denied"),
        404
      );
    }

    // Check if transaction with this invoice ID already exists
    const { data: existingTransaction } = await supabase
      .from("transactions")
      .select("id")
      .eq("pos_invoice_id", transactionData.pos_invoice_id)
      .eq("shop_id", transactionData.shop_id)
      .single();

    if (existingTransaction) {
      return c.json(
        standardResponse(
          400,
          "Transaction with this invoice ID already exists"
        ),
        400
      );
    }

    // Create transaction
    const { data: transaction, error } = await supabase
      .from("transactions")
      .insert({
        shop_id: transactionData.shop_id,
        pos_invoice_id: transactionData.pos_invoice_id,
        total_amount: transactionData.total_amount,
        tax_amount: transactionData.tax_amount || 0,
        items: transactionData.items,
        status: "pending",
        metadata: transactionData.metadata || {},
      })
      .select(
        "id, shop_id, pos_invoice_id, total_amount, status, qr_code_data, created_at"
      )
      .single();

    if (error) {
      logger.error("Failed to create transaction:", error);
      return c.json(standardResponse(500, "Failed to create transaction"), 500);
    }

    logger.info(`Transaction created successfully: ${transaction.id}`);
    return c.json(
      standardResponse(201, "Transaction created successfully", transaction),
      201
    );
  } catch (error) {
    logger.error("Error creating transaction:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Step 5: Get QR code data for receipt printing
const getQRDataRoute = createRoute({
  method: "get",
  path: "/transactions/{transaction_id}/qr-data",
  summary: "Get QR code data for receipt",
  description: "Returns QR code data and display text for receipt printing",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({
      transaction_id: z.string().uuid("Invalid transaction ID"),
    }),
  },
  responses: {
    200: {
      description: "QR data retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: qrDataResponseSchema,
          }),
        },
      },
    },
  },
});

pos.openapi(getQRDataRoute, async (c) => {
  try {
    const { transaction_id } = c.req.valid("param");
    const posProvider = c.get("posProvider");

    // Get transaction with shop info
    const { data: transaction, error } = await supabase
      .from("transactions")
      .select(
        `
        id,
        shop_id,
        pos_invoice_id,
        total_amount,
        qr_code_data,
        status,
        shops (
          name,
          pos_provider_id
        )
      `
      )
      .eq("id", transaction_id)
      .single();

    if (error || !transaction) {
      return c.json(standardResponse(404, "Transaction not found"), 404);
    }

    // Verify transaction belongs to this POS provider
    const shop = transaction.shops as any;
    if (shop.pos_provider_id !== posProvider.id) {
      return c.json(standardResponse(403, "Access denied"), 403);
    }

    const qrData = {
      qr_code_data: transaction.qr_code_data,
      display_text: `Scan for loyalty points\nInvoice: ${transaction.pos_invoice_id}`,
      transaction_id: transaction.id,
      shop_name: shop.name,
      total_amount: transaction.total_amount,
    };

    return c.json(
      standardResponse(200, "QR data retrieved successfully", qrData)
    );
  } catch (error) {
    logger.error("Error getting QR data:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get current pricing for articles (useful for POS systems to check prices)
const getCurrentPricingRoute = createRoute({
  method: "get",
  path: "/shops/{shop_id}/current-pricing",
  summary: "Get current pricing for all shop articles",
  description:
    "Returns current prices for all articles based on time-based pricing rules",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({
      shop_id: z.string().uuid("Invalid shop ID"),
    }),
    query: z.object({
      check_time: z.string().optional(), // ISO timestamp, defaults to now
    }),
  },
  responses: {
    200: {
      description: "Current pricing retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              shop_id: z.string().uuid(),
              check_time: z.string(),
              articles: z.array(
                z.object({
                  id: z.string().uuid(),
                  pos_article_id: z.string(),
                  name: z.string(),
                  base_price: z.number(),
                  current_price: z.number(),
                  active_pricing_rule: z.string().nullable(),
                })
              ),
            }),
          }),
        },
      },
    },
  },
});

pos.openapi(getCurrentPricingRoute, async (c) => {
  try {
    const { shop_id } = c.req.valid("param");
    const { check_time } = c.req.valid("query");
    const posProvider = c.get("posProvider");

    // Verify shop belongs to POS provider
    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .select("id")
      .eq("id", shop_id)
      .eq("pos_provider_id", posProvider.id)
      .eq("status", "active")
      .single();

    if (shopError || !shop) {
      return c.json(
        standardResponse(404, "Shop not found or access denied"),
        404
      );
    }

    const checkTimestamp = check_time || new Date().toISOString();

    // Get all articles with current pricing
    const { data: articles, error } = await supabase.rpc(
      "get_shop_current_pricing",
      {
        p_shop_id: shop_id,
        p_check_time: checkTimestamp,
      }
    );

    if (error) {
      logger.error("Failed to get current pricing:", error);
      return c.json(standardResponse(500, "Failed to get pricing"), 500);
    }

    const result = {
      shop_id,
      check_time: checkTimestamp,
      articles: articles || [],
    };

    return c.json(
      standardResponse(200, "Current pricing retrieved successfully", result)
    );
  } catch (error) {
    logger.error("Error getting current pricing:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

export default pos;
