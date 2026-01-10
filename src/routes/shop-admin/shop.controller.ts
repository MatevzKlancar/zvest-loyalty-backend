import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";
import {
  updateShopSchema,
  shopResponseSchema,
  uploadImageSchema,
  articleResponseSchema,
} from "./schemas";

export const shopController = new OpenAPIHono<UnifiedAuthContext>();

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

shopController.openapi(getShopRoute, async (c) => {
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
        shop_category,
        brand_color,
        loyalty_type,
        points_per_euro,
        opening_hours,
        image_url,
        tag,
        custom_slug,
        is_automated,
        status,
        created_at,
        updated_at,
        customers (
          id,
          name,
          type,
          subscription_tier
        )
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

shopController.openapi(updateShopRoute, async (c) => {
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

    // Check if custom_slug is being set and verify uniqueness
    if (updateData.custom_slug) {
      const { data: existingShop } = await supabase
        .from("shops")
        .select("id")
        .eq("custom_slug", updateData.custom_slug)
        .neq("id", shop.id)
        .single();

      if (existingShop) {
        return c.json(
          standardResponse(409, "This custom URL slug is already in use by another shop"),
          409
        );
      }
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

shopController.openapi(uploadShopImageRoute, async (c) => {
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
            data: z.array(articleResponseSchema),
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

shopController.openapi(getArticlesRoute, async (c) => {
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