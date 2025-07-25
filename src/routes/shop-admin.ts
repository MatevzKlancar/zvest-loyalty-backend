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
  loyalty_type: z.enum(["points", "coupons"]).optional(),
  opening_hours: z.string().optional(), // Simple string like "Mon-Fri: 9:00-18:00, Sat: 10:00-16:00, Sun: Closed"
  image_url: z.string().url().optional(),
  social_media: z
    .object({
      facebook: z.string().optional(),
      instagram: z.string().optional(),
      twitter: z.string().optional(),
      website: z.string().optional(),
    })
    .optional(),
});

const createCouponSchema = z.object({
  code: z.string().min(1, "Coupon code is required"),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().min(0, "Value must be positive"),
  points_required: z.number().min(0, "Points required must be positive"),
  discount_percentage: z.number().min(1).max(100).optional(),
  description: z.string().optional(),

  category: z.string().default("general"),
  min_purchase_amount: z.number().min(0).default(0),
  max_discount_amount: z.number().min(0).optional(),
  expires_at: z.string().datetime().optional(),
  usage_limit: z.number().min(1).optional(),
  image_url: z.string().url().optional(),
});

const updateCouponSchema = createCouponSchema.partial().omit({ code: true });

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
  opening_hours: z.string().nullable(),
  image_url: z.string().nullable(),
  social_media: z.record(z.any()).nullable(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const couponResponseSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  code: z.string(),
  type: z.string(),
  value: z.number(),
  points_required: z.number().nullable(),
  description: z.string().nullable(),
  category: z.string(),
  min_purchase_amount: z.number(),
  max_discount_amount: z.number().nullable(),
  expires_at: z.string().nullable(),
  usage_limit: z.number().nullable(),
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
        opening_hours,
        image_url,
        social_media,
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
  description:
    "Update shop information including opening hours, loyalty type, and contact details",
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

    const { data: updatedShop, error } = await supabase
      .from("shops")
      .update(updateData)
      .eq("id", shop.id)
      .select()
      .single();

    if (error) {
      logger.error("Failed to update shop:", error);
      return c.json(standardResponse(500, "Failed to update shop"), 500);
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

    // Check if coupon code already exists for this shop
    const { data: existingCoupon } = await supabase
      .from("coupons")
      .select("id")
      .eq("shop_id", shop.id)
      .eq("code", couponData.code)
      .single();

    if (existingCoupon) {
      return c.json(
        standardResponse(400, "Coupon code already exists for this shop"),
        400
      );
    }

    const { data: coupon, error } = await supabase
      .from("coupons")
      .insert({
        ...couponData,
        shop_id: shop.id,
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create coupon:", error);
      return c.json(standardResponse(500, "Failed to create coupon"), 500);
    }

    logger.info(`Coupon created successfully: ${coupon.id}`);
    return c.json(
      standardResponse(201, "Coupon created successfully", coupon),
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
      category: z.string().optional(),
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
    const {
      active_only,
      category,
      limit = "50",
      offset = "0",
    } = c.req.valid("query");

    let query = supabase
      .from("coupons")
      .select("*", { count: "exact" })
      .eq("shop_id", shop.id);

    if (active_only === "true") {
      query = query.eq("is_active", true);
    }

    if (category) {
      query = query.eq("category", category);
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

    return c.json({
      success: true,
      message: "Coupons retrieved successfully",
      data: coupons,
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

    return c.json(
      standardResponse(200, "Coupon retrieved successfully", coupon)
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

    const { data: coupon, error } = await supabase
      .from("coupons")
      .update(updateData)
      .eq("id", coupon_id)
      .select()
      .single();

    if (error) {
      logger.error("Failed to update coupon:", error);
      return c.json(standardResponse(500, "Failed to update coupon"), 500);
    }

    logger.info(`Coupon updated successfully: ${coupon_id}`);
    return c.json(standardResponse(200, "Coupon updated successfully", coupon));
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
