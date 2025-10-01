import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";
import {
  authenticateUser,
  requireShopOwner,
  UnifiedAuthContext,
} from "../middleware/unified-auth";

const shopAdmin = new OpenAPIHono<UnifiedAuthContext>();

// Apply unified auth middleware to all routes
shopAdmin.use("*", authenticateUser);
shopAdmin.use("*", requireShopOwner);

// Schemas
const updateShopSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  loyalty_type: z
    .union([
      z.enum(["points", "coupons"]),
      z.literal("").transform(() => undefined),
    ])
    .optional(),
  points_per_euro: z.number().int().min(1).max(1000).optional(),
  opening_hours: z.string().optional(), // Simple string like "Mon-Fri: 9:00-18:00, Sat: 10:00-16:00, Sun: Closed"
  image_url: z.string().url().optional(),
  tag: z.string().optional(),
  qr_display_text: z.string().max(200).optional(), // Custom text to display below QR code on receipt
});

const createCouponSchema = z.object({
  type: z.enum(["percentage", "fixed"]),
  articles: z
    .array(
      z.object({
        article_id: z.string().uuid().nullable(), // null = applies to whole invoice
        article_name: z.string().nullable(), // Article name for display
        discount_value: z.number().min(0, "Discount value must be positive"),
      })
    )
    .min(1, "At least one article is required"),
  points_required: z.number().min(0, "Points required must be positive"),
  name: z.string().min(1, "Coupon name is required"),
  description: z.string().optional(),
  expires_at: z
    .union([z.string().datetime(), z.literal("").transform(() => undefined)])
    .optional(),
  image_url: z
    .union([z.string().url(), z.literal("").transform(() => undefined)])
    .optional(),
  is_active: z.boolean().default(true),
});

const updateCouponSchema = createCouponSchema.partial();

const uploadImageSchema = z.object({
  image_url: z.string().url("Invalid image URL format"),
});

const shopResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  type: z.string().nullable(),
  loyalty_type: z.string().nullable(),
  points_per_euro: z.number().nullable(),
  opening_hours: z.string().nullable(),
  image_url: z.string().nullable(),
  tag: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const couponResponseSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  type: z.string(),
  articles: z.array(
    z.object({
      article_id: z.string().uuid().nullable(),
      article_name: z.string().nullable(),
      discount_value: z.number(),
    })
  ),
  points_required: z.number().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  expires_at: z.string().nullable(),
  used_count: z.number(),
  image_url: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Get shop details
const getShopRoute = createRoute({
  method: "get",
  path: "/shop",
  summary: "Get shop details",
  description: "Get current shop information for business dashboard",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Shop details retrieved successfully",
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

shopAdmin.openapi(getShopRoute, async (c) => {
  try {
    const shop = c.get("shop");

    const { data: shopDetails, error } = await supabase
      .from("shops")
      .select(
        `
        id,
        name,
        description,
        address,
        phone,
        email,
        website,
        type,
        loyalty_type,
        points_per_euro,
        opening_hours,
        image_url,
        tag,
        status,
        created_at,
        updated_at
      `
      )
      .eq("id", shop.id)
      .single();

    if (error) {
      logger.error("Failed to fetch shop details:", error);
      return c.json(standardResponse(500, "Failed to fetch shop details"), 500);
    }

    return c.json(
      standardResponse(200, "Shop details retrieved successfully", shopDetails)
    );
  } catch (error) {
    logger.error("Error fetching shop details:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Update shop details
const updateShopRoute = createRoute({
  method: "put",
  path: "/shop",
  summary: "Update shop details",
  description: `Update shop information including opening hours, loyalty type, and contact details.

**Custom QR Code Text:**
You can customize the text displayed below the QR code on receipts using the \`qr_display_text\` field.

Example: \`"Skeniraj za nagrade!"\`

If not set, defaults to: \`"Skeniraj za ZVEST točke"\``,
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: updateShopSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Shop updated successfully",
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

shopAdmin.openapi(updateShopRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const updateData = c.req.valid("json");

    // Validation: If loyalty_type is being set to "points", ensure points_per_euro is provided
    if (updateData.loyalty_type === "points") {
      if (
        !updateData.points_per_euro &&
        (!shop.points_per_euro || shop.points_per_euro <= 0)
      ) {
        return c.json(
          standardResponse(
            400,
            "points_per_euro is required when loyalty_type is 'points'"
          ),
          400
        );
      }
    }

    // If loyalty_type is already "points" and we're updating points_per_euro, validate it
    if (
      shop.loyalty_type === "points" &&
      updateData.points_per_euro !== undefined &&
      updateData.points_per_euro <= 0
    ) {
      return c.json(
        standardResponse(
          400,
          "points_per_euro must be greater than 0 for points-based loyalty"
        ),
        400
      );
    }

    const { data: updatedShop, error } = await supabase
      .from("shops")
      .update(updateData)
      .eq("id", shop.id)
      .select()
      .single();

    if (error) {
      logger.error("Failed to update shop:", error);
      logger.error("Update data was:", updateData);
      logger.error("Shop ID:", shop.id);
      return c.json(
        standardResponse(500, `Failed to update shop: ${error.message}`),
        500
      );
    }

    logger.info(`Shop updated successfully: ${shop.id}`);
    return c.json(
      standardResponse(200, "Shop updated successfully", updatedShop)
    );
  } catch (error) {
    logger.error("Error updating shop:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Upload/Update shop image
const uploadShopImageRoute = createRoute({
  method: "post",
  path: "/shop/image",
  summary: "Upload shop image",
  description: "Upload or update the shop's business image",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: uploadImageSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Shop image updated successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              image_url: z.string(),
            }),
          }),
        },
      },
    },
  },
});

shopAdmin.openapi(uploadShopImageRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { image_url } = c.req.valid("json");

    // Update shop image URL
    const { data: updatedShop, error } = await supabase
      .from("shops")
      .update({ image_url })
      .eq("id", shop.id)
      .select("image_url")
      .single();

    if (error) {
      logger.error("Failed to update shop image:", error);
      return c.json(standardResponse(500, "Failed to update shop image"), 500);
    }

    logger.info(`Shop image updated successfully: ${shop.id}`);
    return c.json(
      standardResponse(200, "Shop image updated successfully", {
        image_url: updatedShop.image_url,
      })
    );
  } catch (error) {
    logger.error("Error updating shop image:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get all articles for shop
const getArticlesRoute = createRoute({
  method: "get",
  path: "/articles",
  summary: "Get shop articles",
  description: "Get all articles/menu items for the current shop",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      active_only: z.string().optional(),
      category: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Articles retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(
              z.object({
                id: z.string().uuid(),
                pos_article_id: z.string(),
                name: z.string(),
                base_price: z.number(),
                description: z.string().nullable(),
                category: z.string().nullable(),
                type: z.string().nullable(),
                tax_rate: z.number(),
                is_active: z.boolean(),
                created_at: z.string(),
              })
            ),
            meta: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
            }),
          }),
        },
      },
    },
  },
});

shopAdmin.openapi(getArticlesRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const {
      active_only,
      category,
      limit = "50",
      offset = "0",
    } = c.req.valid("query");

    let query = supabase
      .from("articles")
      .select("*", { count: "exact" })
      .eq("shop_id", shop.id);

    if (active_only === "true") {
      query = query.eq("is_active", true);
    }

    if (category) {
      query = query.eq("category", category);
    }

    const {
      data: articles,
      error,
      count,
    } = await query
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      logger.error("Failed to fetch articles:", error);
      return c.json(standardResponse(500, "Failed to fetch articles"), 500);
    }

    return c.json({
      success: true,
      message: "Articles retrieved successfully",
      data: articles || [],
      meta: {
        total: count || 0,
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    logger.error("Error fetching articles:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Create coupon
const createCouponRoute = createRoute({
  method: "post",
  path: "/coupons",
  summary: "Create new coupon",
  description:
    "Create a new coupon for the shop with points requirement and discount settings",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createCouponSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Coupon created successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: couponResponseSchema,
          }),
        },
      },
    },
  },
});

shopAdmin.openapi(createCouponRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const couponData = c.req.valid("json");

    // Validate that all article_ids belong to this shop (if not null)
    for (const article of couponData.articles) {
      if (article.article_id) {
        const { data: articleExists, error: articleError } = await supabase
          .from("articles")
          .select("id")
          .eq("id", article.article_id)
          .eq("shop_id", shop.id)
          .single();

        if (articleError || !articleExists) {
          return c.json(
            standardResponse(
              400,
              `Article ${article.article_id} not found or does not belong to this shop`
            ),
            400
          );
        }
      }
    }

    const { data: coupon, error } = await supabase
      .from("coupons")
      .insert({
        type: couponData.type,
        articles_data: couponData.articles,
        points_required: couponData.points_required,
        name: couponData.name,
        description: couponData.description,
        expires_at: couponData.expires_at,
        image_url: couponData.image_url,
        is_active: couponData.is_active,
        shop_id: shop.id,
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create coupon:", error);
      return c.json(
        standardResponse(500, `Failed to create coupon: ${error.message}`),
        500
      );
    }

    // Transform response to include articles array
    const responseData = {
      ...coupon,
      articles: coupon.articles_data,
    };
    delete responseData.articles_data;

    logger.info(`Coupon created successfully: ${coupon.id}`);
    return c.json(
      standardResponse(201, "Coupon created successfully", responseData),
      201
    );
  } catch (error) {
    logger.error("Error creating coupon:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get all coupons for shop
const getCouponsRoute = createRoute({
  method: "get",
  path: "/coupons",
  summary: "Get all shop coupons",
  description: "Retrieve all coupons for the current shop",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      active_only: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Coupons retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(couponResponseSchema),
            meta: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
            }),
          }),
        },
      },
    },
  },
});

shopAdmin.openapi(getCouponsRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { active_only, limit = "50", offset = "0" } = c.req.valid("query");

    let query = supabase
      .from("coupons")
      .select("*", { count: "exact" })
      .eq("shop_id", shop.id);

    if (active_only === "true") {
      query = query.eq("is_active", true);
    }

    const {
      data: coupons,
      error,
      count,
    } = await query
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      logger.error("Failed to fetch coupons:", error);
      return c.json(standardResponse(500, "Failed to fetch coupons"), 500);
    }

    // Transform response to include articles array
    const transformedCoupons =
      coupons?.map((coupon) => ({
        ...coupon,
        articles: coupon.articles_data || [],
        articles_data: undefined, // Remove from response
      })) || [];

    return c.json({
      success: true,
      message: "Coupons retrieved successfully",
      data: transformedCoupons,
      meta: {
        total: count || 0,
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    logger.error("Error fetching coupons:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get single coupon
const getCouponRoute = createRoute({
  method: "get",
  path: "/coupons/{coupon_id}",
  summary: "Get coupon details",
  description: "Get details of a specific coupon",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      coupon_id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "Coupon retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: couponResponseSchema,
          }),
        },
      },
    },
  },
});

shopAdmin.openapi(getCouponRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { coupon_id } = c.req.valid("param");

    const { data: coupon, error } = await supabase
      .from("coupons")
      .select("*")
      .eq("id", coupon_id)
      .eq("shop_id", shop.id)
      .single();

    if (error || !coupon) {
      return c.json(standardResponse(404, "Coupon not found"), 404);
    }

    // Transform response to include articles array
    const responseData = {
      ...coupon,
      articles: coupon.articles_data || [],
    };
    delete responseData.articles_data;

    return c.json(
      standardResponse(200, "Coupon retrieved successfully", responseData)
    );
  } catch (error) {
    logger.error("Error fetching coupon:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Update coupon
const updateCouponRoute = createRoute({
  method: "put",
  path: "/coupons/{coupon_id}",
  summary: "Update coupon",
  description: "Update an existing coupon",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      coupon_id: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: updateCouponSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Coupon updated successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: couponResponseSchema,
          }),
        },
      },
    },
  },
});

shopAdmin.openapi(updateCouponRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { coupon_id } = c.req.valid("param");
    const updateData = c.req.valid("json");

    // Verify coupon belongs to shop
    const { data: existingCoupon, error: checkError } = await supabase
      .from("coupons")
      .select("id")
      .eq("id", coupon_id)
      .eq("shop_id", shop.id)
      .single();

    if (checkError || !existingCoupon) {
      return c.json(standardResponse(404, "Coupon not found"), 404);
    }

    // If articles are being updated, validate that all article_ids belong to this shop (if not null)
    if (updateData.articles) {
      for (const article of updateData.articles) {
        if (article.article_id) {
          const { data: articleExists, error: articleError } = await supabase
            .from("articles")
            .select("id")
            .eq("id", article.article_id)
            .eq("shop_id", shop.id)
            .single();

          if (articleError || !articleExists) {
            return c.json(
              standardResponse(
                400,
                `Article ${article.article_id} not found or does not belong to this shop`
              ),
              400
            );
          }
        }
      }
    }

    // Transform updateData to use articles_data field
    const dbUpdateData: any = { ...updateData };
    if (updateData.articles) {
      dbUpdateData.articles_data = updateData.articles;
      delete dbUpdateData.articles;
    }

    const { data: coupon, error } = await supabase
      .from("coupons")
      .update(dbUpdateData)
      .eq("id", coupon_id)
      .select()
      .single();

    if (error) {
      logger.error("Failed to update coupon:", error);
      return c.json(standardResponse(500, "Failed to update coupon"), 500);
    }

    // Transform response to include articles array
    const responseData = {
      ...coupon,
      articles: coupon.articles_data || [],
    };
    delete responseData.articles_data;

    logger.info(`Coupon updated successfully: ${coupon_id}`);
    return c.json(
      standardResponse(200, "Coupon updated successfully", responseData)
    );
  } catch (error) {
    logger.error("Error updating coupon:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Delete coupon
const deleteCouponRoute = createRoute({
  method: "delete",
  path: "/coupons/{coupon_id}",
  summary: "Delete coupon",
  description: "Delete a coupon (soft delete by setting is_active to false)",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      coupon_id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "Coupon deleted successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        },
      },
    },
  },
});

shopAdmin.openapi(deleteCouponRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { coupon_id } = c.req.valid("param");

    // Verify coupon belongs to shop
    const { data: existingCoupon, error: checkError } = await supabase
      .from("coupons")
      .select("id")
      .eq("id", coupon_id)
      .eq("shop_id", shop.id)
      .single();

    if (checkError || !existingCoupon) {
      return c.json(standardResponse(404, "Coupon not found"), 404);
    }

    // Soft delete
    const { error } = await supabase
      .from("coupons")
      .update({ is_active: false })
      .eq("id", coupon_id);

    if (error) {
      logger.error("Failed to delete coupon:", error);
      return c.json(standardResponse(500, "Failed to delete coupon"), 500);
    }

    logger.info(`Coupon deleted successfully: ${coupon_id}`);
    return c.json(standardResponse(200, "Coupon deleted successfully"));
  } catch (error) {
    logger.error("Error deleting coupon:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get shop analytics (simple version with TypeScript logic)
const getAnalyticsRoute = createRoute({
  method: "get",
  path: "/analytics",
  summary: "Get shop analytics",
  description:
    "Get comprehensive analytics for the shop including transactions, revenue, and customer data",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Analytics retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              shop_id: z.string().uuid(),
              shop_name: z.string(),
              total_transactions: z.number(),
              transactions_last_30_days: z.number(),
              transactions_last_7_days: z.number(),
              total_revenue: z.number(),
              revenue_last_30_days: z.number(),
              revenue_last_7_days: z.number(),
              avg_transaction_amount: z.number(),
              unique_customers: z.number(),
              total_coupons: z.number(),
              active_coupons: z.number(),
              total_coupon_redemptions: z.number(),
            }),
          }),
        },
      },
    },
  },
});

shopAdmin.openapi(getAnalyticsRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get transactions data
    const { data: transactions, error: transError } = await supabase
      .from("transactions")
      .select("id, total_amount, created_at, app_user_id, status")
      .eq("shop_id", shop.id)
      .eq("status", "completed");

    if (transError) {
      logger.error("Failed to fetch transactions:", transError);
      return c.json(standardResponse(500, "Failed to fetch analytics"), 500);
    }

    // Get coupons data
    const { data: coupons, error: couponError } = await supabase
      .from("coupons")
      .select("id, is_active")
      .eq("shop_id", shop.id);

    if (couponError) {
      logger.error("Failed to fetch coupons:", couponError);
      return c.json(standardResponse(500, "Failed to fetch analytics"), 500);
    }

    // Get coupon redemptions
    const { data: redemptions, error: redemptionError } = await supabase
      .from("coupon_redemptions")
      .select("id, redeemed_at")
      .in("coupon_id", coupons?.map((c) => c.id) || []);

    if (redemptionError) {
      logger.error("Failed to fetch redemptions:", redemptionError);
    }

    // Calculate analytics in TypeScript
    const totalTransactions = transactions?.length || 0;
    const last30DaysTransactions =
      transactions?.filter((t) => new Date(t.created_at) >= thirtyDaysAgo)
        .length || 0;
    const last7DaysTransactions =
      transactions?.filter((t) => new Date(t.created_at) >= sevenDaysAgo)
        .length || 0;

    const totalRevenue =
      transactions?.reduce((sum, t) => sum + t.total_amount, 0) || 0;
    const last30DaysRevenue =
      transactions
        ?.filter((t) => new Date(t.created_at) >= thirtyDaysAgo)
        .reduce((sum, t) => sum + t.total_amount, 0) || 0;
    const last7DaysRevenue =
      transactions
        ?.filter((t) => new Date(t.created_at) >= sevenDaysAgo)
        .reduce((sum, t) => sum + t.total_amount, 0) || 0;

    const avgTransactionAmount =
      totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    const uniqueCustomers = new Set(
      transactions?.map((t) => t.app_user_id).filter(Boolean)
    ).size;

    const totalCoupons = coupons?.length || 0;
    const activeCoupons = coupons?.filter((c) => c.is_active).length || 0;
    const totalCouponRedemptions = redemptions?.length || 0;

    const analytics = {
      shop_id: shop.id,
      shop_name: shop.name,
      total_transactions: totalTransactions,
      transactions_last_30_days: last30DaysTransactions,
      transactions_last_7_days: last7DaysTransactions,
      total_revenue: totalRevenue,
      revenue_last_30_days: last30DaysRevenue,
      revenue_last_7_days: last7DaysRevenue,
      avg_transaction_amount: avgTransactionAmount,
      unique_customers: uniqueCustomers,
      total_coupons: totalCoupons,
      active_coupons: activeCoupons,
      total_coupon_redemptions: totalCouponRedemptions,
    };

    return c.json(
      standardResponse(200, "Analytics retrieved successfully", analytics)
    );
  } catch (error) {
    logger.error("Error fetching analytics:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get recent transactions
const getTransactionsRoute = createRoute({
  method: "get",
  path: "/transactions",
  summary: "Get recent transactions",
  description: "Get recent transactions for the shop",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      limit: z.string().optional(),
      offset: z.string().optional(),
      status: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Transactions retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(
              z.object({
                id: z.string().uuid(),
                pos_invoice_id: z.string(),
                total_amount: z.number(),
                tax_amount: z.number(),
                status: z.string(),
                loyalty_points_awarded: z.number(),
                created_at: z.string(),
                app_user: z
                  .object({
                    first_name: z.string().nullable(),
                    last_name: z.string().nullable(),
                    phone_number: z.string().nullable(),
                  })
                  .nullable(),
              })
            ),
            meta: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
            }),
          }),
        },
      },
    },
  },
});

shopAdmin.openapi(getTransactionsRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { limit = "50", offset = "0", status } = c.req.valid("query");

    let query = supabase
      .from("transactions")
      .select(
        `
        id,
        pos_invoice_id,
        total_amount,
        tax_amount,
        status,
        loyalty_points_awarded,
        created_at,
        app_users (
          first_name,
          last_name,
          phone_number
        )
      `,
        { count: "exact" }
      )
      .eq("shop_id", shop.id);

    if (status) {
      query = query.eq("status", status);
    }

    const {
      data: transactions,
      error,
      count,
    } = await query
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      logger.error("Failed to fetch transactions:", error);
      return c.json(standardResponse(500, "Failed to fetch transactions"), 500);
    }

    return c.json({
      success: true,
      message: "Transactions retrieved successfully",
      data: transactions,
      meta: {
        total: count || 0,
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    logger.error("Error fetching transactions:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

export default shopAdmin;
