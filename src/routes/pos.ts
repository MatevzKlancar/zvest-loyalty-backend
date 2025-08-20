import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { authenticatePOSProvider, type AuthContext } from "../middleware/auth";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";
import {
  isValidRedemptionCodeFormat,
  normalizeRedemptionCode,
} from "../utils/redemption-code";

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
      // Optional promotional pricing (multiple allowed)
      promotional_prices: z
        .array(
          z.object({
            name: z.string().optional(), // e.g., "Happy Hour", "Morning Special"
            price: z.number().min(0),
            start_time: z.string().optional(), // "08:00" format
            end_time: z.string().optional(), // "10:00" format
            start_date: z.string().optional(), // "2024-01-01" format
            end_date: z.string().optional(), // "2024-12-31" format
            days_of_week: z.array(z.number().min(1).max(7)).optional(), // [1,2,3,4,5] for Mon-Fri
            description: z.string().optional(),
          })
        )
        .optional(),
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

const validateCouponSchema = z.object({
  shop_id: z.string().uuid("Invalid shop ID"),
  redemption_id: z
    .string()
    .min(1, "Redemption code is required")
    .max(20, "Redemption code too long"), // Allow longer codes for better error handling
});

// Base shop schema for normal responses
const baseShopResponseSchema = z.object({
  id: z.string().uuid(),
  pos_shop_id: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.string().nullable(),
  status: z.string(),
  pos_synced_at: z.string().nullable(),
  created_at: z.string(),
});

// Extended shop schema for enable shop endpoint (with error handling)
const shopResponseSchema = z.object({
  valid: z.boolean().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  id: z.string().uuid().optional(),
  pos_shop_id: z.string().nullable().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  status: z.string().optional(),
  pos_synced_at: z.string().nullable().optional(),
  created_at: z.string().optional(),
});

const transactionResponseSchema = z.object({
  valid: z.boolean().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid().optional(),
  pos_invoice_id: z.string().optional(),
  total_amount: z.number().optional(),
  status: z.string().optional(),
  qr_code_data: z.string().optional(),
  display_text: z.string().optional(),
  created_at: z.string().optional(),
});

const couponResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  articles: z.array(
    z.object({
      article_id: z.string().uuid().nullable(),
      article_name: z.string().nullable(),
      discount_value: z.number(),
    })
  ),
  name: z.string(),
  description: z.string().nullable(),
  expires_at: z.string().nullable(),
  used_count: z.number(),
  points_required: z.number().nullable(),
  is_active: z.boolean(),
});

const validatedCouponResponseSchema = z.object({
  valid: z.boolean(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  redemption_id: z.string().optional(),
  coupon: z
    .object({
      id: z.string().uuid(),
      name: z.string(), // description field as name
      description: z.string().nullable(),
      type: z.string(), // "percentage" or "fixed"
      articles: z.array(
        z.object({
          article_id: z.string().uuid().nullable(), // null = applies to whole invoice
          article_name: z.string().nullable(), // Article name for display, null for global coupons
          discount_value: z.number(), // Percentage (0-100) or fixed amount, interpreted based on coupon.type
        })
      ),
    })
    .optional(),
  shop: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
    })
    .optional(),
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
            data: z.array(baseShopResponseSchema),
          }),
        },
      },
    },
  },
});

pos.openapi(getShopsRoute, async (c) => {
  try {
    const posProvider = c.get("posProvider");

    logger.info(
      `Querying shops for POS provider ID: ${posProvider.id} (${posProvider.name})`
    );

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
        created_at,
        pos_provider_id
      `
      )
      .eq("pos_provider_id", posProvider.id)
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
  description:
    "Activates a pending shop and connects it to the POS system. Only shops in 'pending' status can be enabled.",
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

    // Verify shop belongs to this POS provider and is in pending status
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

    // Only allow enabling shops that are in pending status
    if (existingShop.status !== "pending") {
      // Business logic error: shop not in pending status - return 200 with error details
      return c.json(
        standardResponse(200, "Shop enablement completed", {
          valid: false,
          error_code: "invalid_status",
          error_message: `Shop must be in pending status to enable. Current status: ${existingShop.status}`,
        })
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
        // Business logic error: POS shop ID already in use - return 200 with error details
        return c.json(
          standardResponse(200, "Shop enablement completed", {
            valid: false,
            error_code: "pos_id_in_use",
            error_message: `POS shop ID '${enableData.pos_shop_id}' is already in use by another shop`,
          })
        );
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
    return c.json(
      standardResponse(200, "Shop enabled successfully", {
        valid: true,
        ...shop,
      })
    );
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

    // Verify shop belongs to POS provider (allow pending and active shops)
    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .select("id, status")
      .eq("id", shop_id)
      .eq("pos_provider_id", posProvider.id)
      .single();

    if (shopError || !shop) {
      return c.json(
        standardResponse(404, "Shop not found or access denied"),
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
      }));

      const { data: insertedArticles, error: insertError } = await supabase
        .from("articles")
        .insert(articleInserts)
        .select("id, pos_article_id");

      if (insertError) {
        logger.error("Failed to insert new articles:", insertError);
        return c.json(standardResponse(500, "Failed to sync articles"), 500);
      }

      // Insert promotional prices for articles that have them
      const pricingRuleInserts: any[] = [];
      for (const article of articles) {
        if (
          article.promotional_prices &&
          article.promotional_prices.length > 0
        ) {
          const articleId = insertedArticles.find(
            (a) => a.pos_article_id === article.pos_article_id
          )?.id;

          if (articleId) {
            // Insert all promotional prices for this article
            for (const promo of article.promotional_prices) {
              pricingRuleInserts.push({
                article_id: articleId,
                name: promo.name || null,
                price: promo.price,
                start_time: promo.start_time || null,
                end_time: promo.end_time || null,
                start_date: promo.start_date || null,
                end_date: promo.end_date || null,
                days_of_week: promo.days_of_week || null,
                priority: 1, // Default priority for all promotional prices
                description: promo.description || null,
              });
            }
          }
        }
      }

      // Insert promotional prices if any exist
      if (pricingRuleInserts.length > 0) {
        const { error: pricingError } = await supabase
          .from("article_pricing")
          .insert(pricingRuleInserts);

        if (pricingError) {
          logger.error("Failed to insert promotional prices:", pricingError);
          // Don't fail the entire sync, just log the error
          logger.warn("Continuing sync without promotional pricing");
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
curl -X POST https://zvest-loyalty-backend.onrender.com/api/pos/transactions \\
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
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: transactionResponseSchema,
          }),
          examples: {
            success: {
              summary: "Transaction Created Successfully",
              value: {
                success: true,
                message: "Transaction created successfully",
                data: {
                  valid: true,
                  id: "456e7890-e89b-12d3-a456-426614174111",
                  shop_id: "123e4567-e89b-12d3-a456-426614174000",
                  pos_invoice_id: "INV-2024-001",
                  total_amount: 15.5,
                  status: "pending",
                  qr_code_data: "PLT_456e7890-e89b-12d3-a456-426614174111",
                  display_text:
                    "Scan for loyalty points\nInvoice: INV-2024-001",
                  created_at: "2024-01-15T14:25:00Z",
                },
              },
            },
            duplicateInvoice: {
              summary: "Duplicate Invoice ID",
              value: {
                success: true,
                message: "Transaction creation completed",
                data: {
                  valid: false,
                  error_code: "duplicate_invoice",
                  error_message:
                    "Transaction with invoice ID 'INV-2024-001' already exists for this shop",
                },
              },
            },
          },
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
      // Business logic error: duplicate invoice ID - return 200 with error details
      return c.json(
        standardResponse(200, "Transaction creation completed", {
          valid: false,
          error_code: "duplicate_invoice",
          error_message: `Transaction with invoice ID '${transactionData.pos_invoice_id}' already exists for this shop`,
        })
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

    // Add display text for receipt printing and valid flag
    const transactionWithDisplayText = {
      valid: true,
      ...transaction,
      display_text: `Scan for loyalty points\nInvoice: ${transaction.pos_invoice_id}`,
    };

    logger.info(`Transaction created successfully: ${transaction.id}`);
    return c.json(
      standardResponse(
        201,
        "Transaction created successfully",
        transactionWithDisplayText
      ),
      201
    );
  } catch (error) {
    logger.error("Error creating transaction:", error);
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
                  active_promotional_price: z.string().nullable(),
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

// Get shop coupons for POS display
const getShopCouponsRoute = createRoute({
  method: "get",
  path: "/shops/{shop_id}/coupons",
  summary: "Get active coupons for shop",
  description:
    "Returns all active coupons available for the shop that can be redeemed by customers",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({
      shop_id: z.string().uuid("Invalid shop ID"),
    }),
  },
  responses: {
    200: {
      description: "Shop coupons retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(couponResponseSchema),
          }),
        },
      },
    },
  },
});

pos.openapi(getShopCouponsRoute, async (c) => {
  try {
    const { shop_id } = c.req.valid("param");
    const posProvider = c.get("posProvider");

    // Verify shop belongs to POS provider
    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .select("id, name")
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

    // Get active coupons for the shop
    const { data: coupons, error } = await supabase
      .from("coupons")
      .select("*")
      .eq("shop_id", shop_id)
      .eq("is_active", true)
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      logger.error("Failed to fetch shop coupons:", error);
      return c.json(standardResponse(500, "Failed to fetch coupons"), 500);
    }

    // Transform response to include articles array
    const transformedCoupons =
      coupons?.map((coupon) => ({
        ...coupon,
        articles: coupon.articles_data || [],
        articles_data: undefined, // Remove from response
      })) || [];

    return c.json(
      standardResponse(
        200,
        "Shop coupons retrieved successfully",
        transformedCoupons
      )
    );
  } catch (error) {
    logger.error("Error fetching shop coupons:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Validate and redeem coupon via QR scan
const validateCouponRoute = createRoute({
  method: "post",
  path: "/coupons/validate",
  summary: "Validate and redeem coupon",
  description: `
Validates a coupon redemption ID from QR code scan and applies the discount if valid.

## 🎯 Smart Error Handling

**This endpoint uses business-logic-friendly error handling:**

**✅ ALL validation results return HTTP 200 OK** - whether valid or invalid
- Valid coupon → \`{ data: { valid: true, coupon: {...} } }\`
- Expired coupon → \`{ data: { valid: false, error_code: "coupon_expired" } }\`
- Invalid code → \`{ data: { valid: false, error_code: "invalid_code" } }\`
- Wrong format → \`{ data: { valid: false, error_code: "invalid_format" } }\`

**❌ Only technical errors use HTTP 4xx/5xx** (auth failures, server errors)

This approach makes POS integration much simpler - no complex error handling needed!

## Flow
1. Customer shows QR code containing redemption ID
2. POS system scans QR code and extracts redemption ID
3. POS calls this endpoint to validate and redeem coupon
4. System checks validity (5 minute expiry) and marks as used
5. Returns discount amount and coupon details for POS to apply

## Error Codes Reference
| Code | Meaning | Action |
|------|---------|---------|
| \`coupon_expired\` | Coupon past expiry date | Show expiry date to customer |
| \`redemption_expired\` | 5-minute window passed | Ask customer to generate new code |
| \`invalid_code\` | Code not found/already used | Ask customer to check code |
| \`invalid_format\` | Wrong number of digits | Ask customer to re-enter |
| \`wrong_shop\` | Coupon for different location | Explain location restriction |

## POS Integration Example
\`\`\`javascript
const result = await validateCoupon(shopId, redemptionCode);

// Always check result.data.valid first
if (result.data.valid) {
  // Apply discount using result.data.coupon
  applyCouponDiscount(result.data.coupon);
  showSuccess("Coupon applied successfully!");
} else {
  // Show specific error message to staff
  showError(result.data.error_message);
  // e.g., "This coupon expired on January 15, 2024"
}
\`\`\`

## Coupon Structure
All coupons use a consistent \`articles\` array format:
- **Global Coupons**: \`articles[0].article_id = null\` (applies to entire invoice)
- **Single-Article Coupons**: \`articles[0].article_id = "uuid"\` (applies to specific item)
- **Multi-Article Coupons**: Multiple items in \`articles\` array with different discount values

## Important Notes
- Coupon redemptions expire after 5 minutes
- Once validated, coupon is marked as "used" and cannot be reused
- Discount percentage is returned as 0-100 (e.g., 20 = 20% off)
- All coupons use the \`articles\` array format for consistency
- Same \`type\` (percentage/fixed) applies to all articles, but different \`discount_value\` per article
  `,
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: validateCouponSchema.openapi({
            example: {
              shop_id: "123e4567-e89b-12d3-a456-426614174000",
              redemption_id: "394750",
            },
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description:
        "Coupon validation response (success or business logic error)",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: validatedCouponResponseSchema,
          }),
          examples: {
            validCoupon: {
              summary: "Valid Coupon - Successfully Redeemed",
              value: {
                success: true,
                message: "Coupon validation completed",
                data: {
                  valid: true,
                  redemption_id: "394750",
                  coupon: {
                    id: "123e4567-e89b-12d3-a456-426614174000",
                    name: "20% Off Everything",
                    description: "Store-wide discount",
                    type: "percentage",
                    articles: [
                      {
                        article_id: null,
                        article_name: null,
                        discount_value: 20,
                      },
                    ],
                  },
                  shop: {
                    id: "456e7890-e89b-12d3-a456-426614174111",
                    name: "Fashion Boutique",
                  },
                },
              },
            },
            expiredCoupon: {
              summary: "Expired Coupon",
              value: {
                success: true,
                message: "Coupon validation completed",
                data: {
                  valid: false,
                  error_code: "coupon_expired",
                  error_message: "This coupon expired on January 15, 2024",
                },
              },
            },
            alreadyUsedCoupon: {
              summary: "Already Used Coupon",
              value: {
                success: true,
                message: "Coupon validation completed",
                data: {
                  valid: false,
                  error_code: "coupon_already_used",
                  error_message: "This coupon has already been used",
                },
              },
            },
            invalidCode: {
              summary: "Invalid Redemption Code",
              value: {
                success: true,
                message: "Coupon validation completed",
                data: {
                  valid: false,
                  error_code: "invalid_code",
                  error_message: "Redemption code not found or invalid",
                },
              },
            },
            redemptionExpired: {
              summary: "Redemption Window Expired",
              value: {
                success: true,
                message: "Coupon validation completed",
                data: {
                  valid: false,
                  error_code: "redemption_expired",
                  error_message:
                    "Redemption window expired (valid for 5 minutes only)",
                },
              },
            },
            invalidFormat: {
              summary: "Invalid Code Format (too short/long)",
              value: {
                success: true,
                message: "Coupon validation completed",
                data: {
                  valid: false,
                  error_code: "invalid_format",
                  error_message: "Redemption code too short - must be 6 digits",
                },
              },
            },
          },
        },
      },
    },
    400: {
      description:
        "Technical error (malformed request, missing required fields, etc.)",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string(),
          }),
        },
      },
    },
    401: {
      description: "Invalid API key",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string(),
          }),
        },
      },
    },
    404: {
      description: "Shop not found or access denied",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string(),
          }),
        },
      },
    },
  },
});

pos.openapi(validateCouponRoute, async (c) => {
  try {
    const { shop_id, redemption_id } = c.req.valid("json");
    const posProvider = c.get("posProvider");

    // Normalize redemption code (remove dashes if present) and validate
    const normalizedCode = normalizeRedemptionCode(redemption_id);

    // Check code format - handle different cases
    if (!isValidRedemptionCodeFormat(normalizedCode)) {
      // Business logic error: code format invalid (too short/long, not digits)
      let errorMessage = "Invalid redemption code format";

      if (normalizedCode.length < 6) {
        errorMessage = "Redemption code too short - must be 6 digits";
      } else if (normalizedCode.length > 6) {
        errorMessage = "Redemption code too long - must be 6 digits";
      } else if (!/^\d{6}$/.test(normalizedCode)) {
        errorMessage = "Redemption code must contain only digits";
      }

      return c.json(
        standardResponse(200, "Coupon validation completed", {
          valid: false,
          error_code: "invalid_format",
          error_message: errorMessage,
        })
      );
    }

    // Verify shop belongs to POS provider
    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .select("id, name")
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

    // Get coupon redemption with coupon details
    const { data: redemption, error: redemptionError } = await supabase
      .from("coupon_redemptions")
      .select(
        `
        id,
        coupon_id,
        app_user_id,
        points_deducted,
        redeemed_at,
        status,
        coupons (
          id,
          shop_id,
          type,
          name,
          description,
          articles_data,
          expires_at
        )
      `
      )
      .eq("redemption_code", normalizedCode)
      .eq("status", "active")
      .single();

    if (redemptionError || !redemption) {
      // Business logic error: code not found or already used - return 200 with error details
      return c.json(
        standardResponse(200, "Coupon validation completed", {
          valid: false,
          error_code: "invalid_code",
          error_message: "Redemption code not found or invalid",
        })
      );
    }

    const coupon = redemption.coupons as any;

    // Verify coupon belongs to the shop
    if (coupon.shop_id !== shop_id) {
      // Business logic error: wrong shop - return 200 with error details
      return c.json(
        standardResponse(200, "Coupon validation completed", {
          valid: false,
          error_code: "wrong_shop",
          error_message: "This coupon cannot be used at this location",
        })
      );
    }

    // Check if redemption has expired (5 minutes from redeemed_at)
    const redeemedTime = new Date(redemption.redeemed_at);
    const expiryTime = new Date(redeemedTime.getTime() + 5 * 60 * 1000); // 5 minutes
    const now = new Date();

    if (now > expiryTime) {
      // Mark as expired
      await supabase
        .from("coupon_redemptions")
        .update({ status: "expired" })
        .eq("redemption_code", normalizedCode);

      // Business logic error: redemption window expired - return 200 with error details
      return c.json(
        standardResponse(200, "Coupon validation completed", {
          valid: false,
          error_code: "redemption_expired",
          error_message: "Redemption window expired (valid for 5 minutes only)",
        })
      );
    }

    // Check coupon's own expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < now) {
      // Business logic error: coupon expired - return 200 with error details
      const expiredDate = new Date(coupon.expires_at).toLocaleDateString(
        "en-US",
        {
          year: "numeric",
          month: "long",
          day: "numeric",
        }
      );
      return c.json(
        standardResponse(200, "Coupon validation completed", {
          valid: false,
          error_code: "coupon_expired",
          error_message: `This coupon expired on ${expiredDate}`,
        })
      );
    }

    // Mark redemption as used
    const { error: updateError } = await supabase
      .from("coupon_redemptions")
      .update({
        status: "used",
        // Note: articles_data contains the discount info, not a simple value field
      })
      .eq("redemption_code", normalizedCode);

    if (updateError) {
      logger.error("Failed to update coupon redemption status:", updateError);
      return c.json(
        standardResponse(500, "Failed to mark coupon as used"),
        500
      );
    }

    // Generate message based on coupon type and articles_data
    let message = "Special offer applied";
    let scopeMessage = "";

    try {
      if (coupon.articles_data) {
        const articlesData = JSON.parse(coupon.articles_data);

        if (coupon.type === "percentage") {
          const percentage =
            articlesData.percentage || articlesData.discount_percentage;
          if (percentage === 100) {
            message = `Free item (100% discount)`;
          } else if (percentage) {
            message = `Apply ${percentage}% discount`;
          }
        } else if (coupon.type === "fixed") {
          const amount = articlesData.amount || articlesData.discount_amount;
          if (amount) {
            message = `Apply €${amount} discount`;
          }
        }

        // Check scope based on articles_data structure
        if (articlesData.articles && articlesData.articles.length > 0) {
          scopeMessage = " (applies to specific items only)";
        } else {
          scopeMessage = " (applies to entire order)";
        }
      }
    } catch (error) {
      logger.error("Error parsing articles_data for coupon message:", error);
      message = "Special offer applied";
      scopeMessage = "";
    }

    // Always use articles array format for consistency
    let articles: any[] = [];

    if (coupon.articles_data) {
      // Multi-article coupon from articles_data
      const articlesData = Array.isArray(coupon.articles_data)
        ? coupon.articles_data
        : JSON.parse(coupon.articles_data);

      articles = articlesData.map((article: any) => ({
        article_id: article.article_id,
        article_name: article.article_name,
        discount_value: article.discount_value,
      }));
    } else {
      // Traditional single-article or global coupon - convert to articles array
      articles = [
        {
          article_id: coupon.article_id, // null = whole invoice, UUID = specific article
          article_name: null, // We don't have article name in traditional coupons
          discount_value: coupon.value,
        },
      ];
    }

    const couponData = {
      id: coupon.id,
      name: coupon.name,
      description: coupon.description,
      type: coupon.type,
      articles: articles,
    };

    const validationData = {
      valid: true,
      redemption_id: redemption.id,
      coupon: couponData,
      shop: {
        id: shop.id,
        name: shop.name,
      },
    };

    logger.info(
      `Coupon redeemed successfully: ${redemption_id} for shop: ${shop_id}`
    );
    return c.json(
      standardResponse(200, "Coupon validation completed", validationData)
    );
  } catch (error) {
    logger.error("Error validating coupon:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// STORNO endpoint - Cancel/reverse transaction and remove awarded points
const stornoTransactionSchema = z.object({
  pos_invoice_id: z.string().min(1, "POS invoice ID is required"),
  reason: z.string().optional(), // Optional reason for cancellation
});

const stornoResponseSchema = z.object({
  valid: z.boolean().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  pos_invoice_id: z.string().optional(),
});

const stornoTransactionRoute = createRoute({
  method: "post",
  path: "/transactions/storno",
  summary: "Cancel/reverse transaction (STORNO)",
  description: `
Cancels a transaction and reverses any loyalty benefits that were awarded. This is typically used when a sale needs to be voided due to staff errors.

**Process Flow:**
1. POS system needs to cancel a transaction due to error
2. POS calls this endpoint with the invoice ID
3. System finds the transaction and checks its current status
4. If loyalty points/stamps were awarded, they are deducted from customer account
5. Transaction is marked as cancelled and logged

**Important Notes:**
- Only transactions in 'pending' or 'completed' status can be cancelled
- If customer already scanned QR and received points, those points will be deducted
- If customer has insufficient points balance, the operation will still proceed (balance can go negative)
- All changes are logged for audit purposes
- Cannot reverse transactions that are already cancelled or refunded

 **Example Usage:**
 \`\`\`bash
 curl -X POST https://zvest-loyalty-backend.onrender.com/api/pos/transactions/storno \\
   -H "Content-Type: application/json" \\
   -H "X-API-Key: your-api-key" \\
   -d '{
     "pos_invoice_id": "INV-2024-001",
     "reason": "Staff error - wrong items entered"
   }'
 \`\`\`
 
 **Example Response:**
 \`\`\`json
 {
   "success": true,
   "message": "Transaction cancelled successfully and reversed 50 points",
   "data": {
     "pos_invoice_id": "INV-2024-001"
   }
 }
 \`\`\`
  `,
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: stornoTransactionSchema.openapi({
            example: {
              pos_invoice_id: "INV-2024-001",
              reason: "Staff error - wrong items entered",
            },
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Transaction cancelled successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: stornoResponseSchema,
          }),
        },
      },
    },
    404: {
      description: "Transaction not found",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string(),
          }),
        },
      },
    },
    400: {
      description: "Transaction cannot be cancelled",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string(),
          }),
        },
      },
    },
  },
});

pos.openapi(stornoTransactionRoute, async (c) => {
  try {
    const { pos_invoice_id, reason } = c.req.valid("json");
    const posProvider = c.get("posProvider");

    // Find the transaction and verify it belongs to this POS provider
    const { data: transaction, error: transactionError } = await supabase
      .from("transactions")
      .select(
        `
        id,
        shop_id,
        pos_invoice_id,
        total_amount,
        app_user_id,
        loyalty_account_id,
        loyalty_points_awarded,
        loyalty_stamps_awarded,
        status,
        qr_scanned_at,
        created_at,
        shops!inner(
          id,
          name,
          pos_provider_id
        )
      `
      )
      .eq("pos_invoice_id", pos_invoice_id)
      .eq("shops.pos_provider_id", posProvider.id)
      .single();

    if (transactionError || !transaction) {
      return c.json(
        standardResponse(404, "Transaction not found or access denied"),
        404
      );
    }

    const previousStatus = transaction.status;

    // Check if transaction can be cancelled
    if (
      transaction.status === "cancelled" ||
      transaction.status === "refunded"
    ) {
      // Business logic error: transaction already processed - return 200 with error details
      return c.json(
        standardResponse(200, "Transaction storno completed", {
          valid: false,
          error_code: "already_processed",
          error_message: `Transaction is already ${transaction.status}`,
        })
      );
    }

    // Track what we're reversing
    let pointsReversed = 0;
    let stampsReversed = 0;
    let amountReversed = 0;

    // Only reverse points if customer actually scanned the QR code (qr_scanned_at is not null)
    // This means the customer received the points and we need to deduct them
    if (
      transaction.app_user_id &&
      transaction.loyalty_account_id &&
      transaction.qr_scanned_at
    ) {
      const pointsToReverse = transaction.loyalty_points_awarded || 0;
      const stampsToReverse = transaction.loyalty_stamps_awarded || 0;
      const totalAmountToReverse = transaction.total_amount || 0;

      if (pointsToReverse > 0 || stampsToReverse > 0) {
        // Get current loyalty account balance
        const { data: loyaltyAccount, error: accountError } = await supabase
          .from("customer_loyalty_accounts")
          .select("points_balance, stamps_count, visits_count, total_spent")
          .eq("id", transaction.loyalty_account_id)
          .single();

        if (accountError) {
          logger.error("Failed to get loyalty account:", accountError);
          return c.json(
            standardResponse(500, "Failed to access loyalty account"),
            500
          );
        }

        // Calculate new balances (allow negative balances)
        const newPointsBalance =
          (loyaltyAccount.points_balance || 0) - pointsToReverse;
        const newStampsCount = Math.max(
          0,
          (loyaltyAccount.stamps_count || 0) - stampsToReverse
        );
        const newVisitsCount = Math.max(
          0,
          (loyaltyAccount.visits_count || 0) - 1
        );
        const newTotalSpent = Math.max(
          0,
          (loyaltyAccount.total_spent || 0) - totalAmountToReverse
        );

        // Update loyalty account
        const { error: updateAccountError } = await supabase
          .from("customer_loyalty_accounts")
          .update({
            points_balance: newPointsBalance,
            stamps_count: newStampsCount,
            visits_count: newVisitsCount,
            total_spent: newTotalSpent,
            updated_at: new Date().toISOString(),
          })
          .eq("id", transaction.loyalty_account_id);

        if (updateAccountError) {
          logger.error("Failed to update loyalty account:", updateAccountError);
          return c.json(
            standardResponse(500, "Failed to reverse loyalty benefits"),
            500
          );
        }

        pointsReversed = pointsToReverse;
        stampsReversed = stampsToReverse;
        amountReversed = totalAmountToReverse;

        logger.info(
          `Reversed loyalty benefits: ${pointsToReverse} points, ${stampsToReverse} stamps for transaction ${transaction.id}`
        );
      }
    }

    // Update transaction status to cancelled
    const { error: updateTransactionError } = await supabase
      .from("transactions")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", transaction.id);

    if (updateTransactionError) {
      logger.error(
        "Failed to update transaction status:",
        updateTransactionError
      );
      return c.json(standardResponse(500, "Failed to cancel transaction"), 500);
    }

    // Log the storno action
    const logDetails = {
      reason: reason || "POS storno operation",
      previous_status: previousStatus,
      points_reversed: pointsReversed,
      stamps_reversed: stampsReversed,
      amount_reversed: amountReversed,
      pos_provider_id: posProvider.id,
      pos_provider_name: posProvider.name,
    };

    const { error: logError } = await supabase.from("transaction_logs").insert({
      transaction_id: transaction.id,
      action: "storno",
      details: logDetails,
      performed_by: `POS Provider: ${posProvider.name}`,
    });

    if (logError) {
      logger.error("Failed to log storno action:", logError);
      // Don't fail the operation, just log the error
    }

    // Generate response message
    let message = `Transaction cancelled successfully`;
    if (pointsReversed > 0 || stampsReversed > 0) {
      const benefits: string[] = [];
      if (pointsReversed > 0) benefits.push(`${pointsReversed} points`);
      if (stampsReversed > 0) benefits.push(`${stampsReversed} stamps`);
      message += ` and reversed ${benefits.join(" and ")}`;
    }

    const responseData = {
      valid: true,
      pos_invoice_id: transaction.pos_invoice_id,
    };

    logger.info(`Transaction storno completed: ${pos_invoice_id} - ${message}`);

    return c.json(standardResponse(200, message, responseData));
  } catch (error) {
    logger.error("Error processing storno:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

export default pos;
