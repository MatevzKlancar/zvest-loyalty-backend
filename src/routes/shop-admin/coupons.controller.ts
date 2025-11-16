import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";
import {
  createCouponSchema,
  updateCouponSchema,
  couponResponseSchema,
} from "./schemas";

export const couponsController = new OpenAPIHono<UnifiedAuthContext>();

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

couponsController.openapi(createCouponRoute, async (c) => {
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

couponsController.openapi(getCouponsRoute, async (c) => {
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

couponsController.openapi(getCouponRoute, async (c) => {
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

couponsController.openapi(updateCouponRoute, async (c) => {
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

couponsController.openapi(deleteCouponRoute, async (c) => {
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