import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";

const publicRoutes = new OpenAPIHono();

// ===========================
// PUBLIC STORE APIS
// ===========================

// Response schemas
const storeResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  opening_hours: z.string().nullable(),
  loyalty_type: z.string(),
  type: z.string().nullable(),
  shop_category: z.string().nullable(),
  brand_color: z.string().nullable(),
  status: z.string(),
  image_url: z.string().nullable(),
  tag: z.string().nullable(),
  created_at: z.string(),
});

const storeDetailsResponseSchema = storeResponseSchema.extend({
  email: z.string().nullable(),
  social_media: z.record(z.any()).nullable(),
  loyalty_programs: z
    .array(
      z.object({
        id: z.string().uuid(),
        type: z.string(),
        points_per_euro: z.number(),
        is_active: z.boolean(),
      })
    )
    .optional(),
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
  points_required: z.number().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  expires_at: z.string().nullable(),
  used_count: z.number(),
  image_url: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
});

// ===========================
// GET /stores - Get all public stores
// ===========================

const getStoresRoute = createRoute({
  method: "get",
  path: "/stores",
  summary: "🏬 Get all public stores",
  description: `
Get all active public stores available for customers to browse and join loyalty programs.

**Features:**
- Returns only active stores
- Supports filtering by store type and location
- Includes basic store information and loyalty program details
- Pagination support for large store lists

**Example Usage:**
\`\`\`bash
curl -X GET 'https://your-api.com/api/public/stores?type=coffee&limit=10'
\`\`\`

**Use Cases:**
- Customer app store directory
- Store locator functionality
- Browse available loyalty programs
  `,
  tags: ["Public"],
  request: {
    query: z.object({
      type: z.string().optional(),
      shop_category: z.enum(["bar", "restaurant", "bakery", "wellness", "pastry", "cafe", "retail", "other"]).optional(),
      city: z.string().optional(),
      loyalty_type: z.enum(["points", "coupons"]).optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Stores retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(storeResponseSchema),
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

publicRoutes.openapi(getStoresRoute, async (c) => {
  try {
    const {
      type,
      shop_category,
      city,
      loyalty_type,
      limit = "20",
      offset = "0",
    } = c.req.valid("query");

    const limitNum = parseInt(limit, 10) || 20;
    const offsetNum = parseInt(offset, 10) || 0;

    let query = supabase
      .from("shops")
      .select(
        `
        id,
        name,
        description,
        address,
        phone,
        website,
        opening_hours,
        loyalty_type,
        type,
        shop_category,
        brand_color,
        status,
        image_url,
        tag,
        created_at
      `
      )
      .eq("status", "active")
      .order("created_at", { ascending: false });

    // Apply filters
    if (type) {
      query = query.eq("type", type);
    }

    if (shop_category) {
      query = query.eq("shop_category", shop_category);
    }

    if (loyalty_type) {
      query = query.eq("loyalty_type", loyalty_type);
    }

    if (city) {
      query = query.ilike("address", `%${city}%`);
    }

    // Apply pagination
    const {
      data: stores,
      error,
      count,
    } = await query.range(offsetNum, offsetNum + limitNum - 1);

    if (error) {
      logger.error("Failed to fetch stores:", error);
      return c.json(standardResponse(500, "Failed to fetch stores"), 500);
    }

    return c.json({
      success: true,
      message: "Stores retrieved successfully",
      data: stores,
      meta: {
        total: count || 0,
        limit: limitNum,
        offset: offsetNum,
      },
    });
  } catch (error) {
    logger.error("Error fetching stores:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// ===========================
// GET /stores/:id - Get store by ID
// ===========================

const getStoreByIdRoute = createRoute({
  method: "get",
  path: "/stores/{id}",
  summary: "🏪 Get store by ID",
  description: `
Get detailed information about a specific store, including loyalty program details and contact information.

**Features:**
- Complete store profile information
- Active loyalty program details
- Contact information and opening hours
- Social media links if available

**Example Usage:**
\`\`\`bash
curl -X GET 'https://your-api.com/api/public/stores/123e4567-e89b-12d3-a456-426614174000'
\`\`\`

**Use Cases:**
- Store detail page in customer app
- Before joining a loyalty program
- Getting store contact information
  `,
  tags: ["Public"],
  request: {
    params: z.object({
      id: z.string().uuid("Invalid store ID"),
    }),
  },
  responses: {
    200: {
      description: "Store details retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: storeDetailsResponseSchema,
          }),
        },
      },
    },
    404: {
      description: "Store not found",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("Store not found"),
          }),
        },
      },
    },
  },
});

publicRoutes.openapi(getStoreByIdRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");

    const { data: store, error } = await supabase
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
        opening_hours,
        loyalty_type,
        type,
        shop_category,
        brand_color,
        status,
        image_url,
        tag,
        social_media,
        created_at,
        loyalty_programs (
          id,
          type,
          points_per_euro,
          is_active
        )
      `
      )
      .eq("id", id)
      .eq("status", "active")
      .single();

    if (error || !store) {
      return c.json(standardResponse(404, "Store not found"), 404);
    }

    return c.json(
      standardResponse(200, "Store details retrieved successfully", store)
    );
  } catch (error) {
    logger.error("Error fetching store details:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// ===========================
// GET /stores/:id/coupons - Get coupons for a specific store
// ===========================

const getStoreCouponsRoute = createRoute({
  method: "get",
  path: "/stores/{id}/coupons",
  summary: "🎟️ Get coupons for a specific store",
  description: `
Get all active coupons available for a specific store that customers can redeem.

**Features:**
- Returns only active, non-expired coupons
- Includes redemption requirements and terms
- Supports filtering by category and coupon type
- Shows usage limits and current usage count

**Example Usage:**
\`\`\`bash
curl -X GET 'https://your-api.com/api/public/stores/123e4567-e89b-12d3-a456-426614174000/coupons?category=food'
\`\`\`

**Use Cases:**
- Display available rewards in customer app
- Coupon browsing and selection
- Loyalty program benefits showcase
  `,
  tags: ["Public"],
  request: {
    params: z.object({
      id: z.string().uuid("Invalid store ID"),
    }),
    query: z.object({
      type: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Store coupons retrieved successfully",
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
              store_name: z.string(),
            }),
          }),
        },
      },
    },
    404: {
      description: "Store not found",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("Store not found"),
          }),
        },
      },
    },
  },
});

publicRoutes.openapi(getStoreCouponsRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const { type, limit = "20", offset = "0" } = c.req.valid("query");

    const limitNum = parseInt(limit, 10) || 20;
    const offsetNum = parseInt(offset, 10) || 0;

    // First verify the store exists and is active
    const { data: store, error: storeError } = await supabase
      .from("shops")
      .select("id, name, status")
      .eq("id", id)
      .eq("status", "active")
      .single();

    if (storeError || !store) {
      return c.json(standardResponse(404, "Store not found"), 404);
    }

    // Build coupon query
    let query = supabase
      .from("coupons")
      .select("*", { count: "exact" })
      .eq("shop_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    // Apply filters
    if (type) {
      query = query.eq("type", type);
    }

    // Filter out expired coupons
    query = query.or(
      "expires_at.is.null,expires_at.gt." + new Date().toISOString()
    );

    // Apply pagination
    const {
      data: coupons,
      error: couponsError,
      count,
    } = await query.range(offsetNum, offsetNum + limitNum - 1);

    if (couponsError) {
      logger.error("Failed to fetch store coupons:", couponsError);
      return c.json(
        standardResponse(500, "Failed to fetch store coupons"),
        500
      );
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
      message: "Store coupons retrieved successfully",
      data: transformedCoupons,
      meta: {
        total: count || 0,
        limit: limitNum,
        offset: offsetNum,
        store_name: store.name,
      },
    });
  } catch (error) {
    logger.error("Error fetching store coupons:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// ===========================
// GET /stores/:id/menu - Get menu for a specific store
// ===========================

const menuItemSchema = z.object({
  id: z.string().uuid(),
  pos_article_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  base_price: z.number(),
  tax_rate: z.number(),
  type: z.string().nullable(),
  is_active: z.boolean(),
});

const menuResponseSchema = z.object({
  shop: z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    type: z.string().nullable(),
    shop_category: z.string().nullable(),
    brand_color: z.string().nullable(),
  }),
  menu: z.record(z.array(menuItemSchema)),
  categories: z.array(z.string()),
  total_items: z.number(),
});

const getStoreMenuRoute = createRoute({
  method: "get",
  path: "/stores/{id}/menu",
  summary: "🍽️ Get store menu",
  description: `
Get the complete menu for a specific store, organized by categories. Perfect for consumer apps to display restaurant/shop menus.

**Features:**
- Returns menu items grouped by categories (e.g., "Pice", "Beverages", "Desserts")
- Includes pricing, descriptions, and item details
- Filters active items by default
- Sorts categories and items alphabetically
- Returns basic shop information for context

**Example Usage:**
\`\`\`bash
curl -X GET 'https://your-api.com/api/public/stores/123e4567-e89b-12d3-a456-426614174000/menu?active_only=true'
\`\`\`

**Use Cases:**
- Consumer app menu display
- Online ordering systems
- Digital menu boards
- Restaurant website integration
  `,
  tags: ["Public"],
  request: {
    params: z.object({
      id: z.string().uuid("Invalid store ID"),
    }),
    query: z.object({
      active_only: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Menu retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: menuResponseSchema,
          }),
        },
      },
    },
    404: {
      description: "Store not found",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("Store not found"),
          }),
        },
      },
    },
  },
});

publicRoutes.openapi(getStoreMenuRoute, async (c) => {
  try {
    const { id } = c.req.valid("param");
    const { active_only = "true" } = c.req.valid("query");

    // First verify the store exists and is active
    const { data: store, error: storeError } = await supabase
      .from("shops")
      .select("id, name, description, type, shop_category, brand_color, status")
      .eq("id", id)
      .eq("status", "active")
      .single();

    if (storeError || !store) {
      return c.json(standardResponse(404, "Store not found"), 404);
    }

    // Build articles query
    let query = supabase
      .from("articles")
      .select("id, pos_article_id, name, description, base_price, tax_rate, type, category, is_active")
      .eq("shop_id", id)
      .order("name", { ascending: true });

    // Filter active items if requested
    if (active_only === "true") {
      query = query.eq("is_active", true);
    }

    const { data: articles, error: articlesError } = await query;

    if (articlesError) {
      logger.error("Failed to fetch store menu:", articlesError);
      return c.json(
        standardResponse(500, "Failed to fetch store menu"),
        500
      );
    }

    // Group articles by category
    const menuByCategory: Record<string, any[]> = {};
    const categories: Set<string> = new Set();

    (articles || []).forEach((article) => {
      const category = article.category || "Other";
      categories.add(category);
      
      if (!menuByCategory[category]) {
        menuByCategory[category] = [];
      }
      
      menuByCategory[category].push({
        id: article.id,
        pos_article_id: article.pos_article_id,
        name: article.name,
        description: article.description,
        base_price: article.base_price,
        tax_rate: article.tax_rate,
        type: article.type,
        is_active: article.is_active,
      });
    });

    // Sort categories alphabetically
    const sortedCategories = Array.from(categories).sort();

    const menuData = {
      shop: {
        id: store.id,
        name: store.name,
        description: store.description,
        type: store.type,
        shop_category: store.shop_category,
        brand_color: store.brand_color,
      },
      menu: menuByCategory,
      categories: sortedCategories,
      total_items: articles?.length || 0,
    };

    return c.json({
      success: true,
      message: "Menu retrieved successfully",
      data: menuData,
    });
  } catch (error) {
    logger.error("Error fetching store menu:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

export default publicRoutes;
