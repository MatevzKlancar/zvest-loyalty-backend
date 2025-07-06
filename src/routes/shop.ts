import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";
import {
  authenticateUser,
  requireShopOwner,
  getUserPermissions,
  UnifiedAuthContext,
} from "../middleware/unified-auth";

const shop = new OpenAPIHono<UnifiedAuthContext>();

// Apply unified auth middleware to all shop routes
shop.use("*", authenticateUser);
shop.use("*", requireShopOwner);

// ===========================
// SHOP OWNER PROFILE ENDPOINT
// ===========================

const shopProfileRoute = createRoute({
  method: "get",
  path: "/profile",
  summary: "🏪 Get shop owner profile",
  description: `
**Shop owner profile endpoint** returns shop-specific profile information.

Returns shop details, subscription info, and shop-specific data.
**Authentication:** Requires shop owner JWT token in Authorization header.
  `,
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Shop owner profile retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              user_type: z.string(),
              user_role: z.string(),
              email: z.string(),
              permissions: z.array(z.string()),
              shop_info: z.object({
                id: z.string(),
                name: z.string(),
                status: z.string(),
                description: z.string().optional(),
                address: z.string().optional(),
                phone: z.string().optional(),
                website: z.string().optional(),
                opening_hours: z.string().optional(),
                loyalty_type: z.string(),
              }),
              subscription_info: z.object({
                customer_id: z.string(),
                customer_name: z.string(),
                subscription_tier: z.string(),
                customer_type: z.string(),
              }),
            }),
          }),
        },
      },
    },
  },
});

shop.openapi(shopProfileRoute, async (c) => {
  try {
    const userType = c.get("userType");
    const userRole = c.get("userRole");
    const user = c.get("user");
    const shopData = c.get("shop");

    const permissions = getUserPermissions(userType, userRole);

    // Get detailed shop information
    const { data: shopDetails, error: shopError } = await supabase
      .from("shops")
      .select(
        `
        id, name, status, description, address, phone, website, 
        opening_hours, loyalty_type, customer_id,
        customers!inner (
          id, name, type, subscription_tier
        )
      `
      )
      .eq("id", shopData.id)
      .single();

    if (shopError) {
      logger.error("Error fetching shop details:", shopError);
      return c.json(standardResponse(500, "Failed to fetch shop details"), 500);
    }

    const profileData = {
      user_type: userType,
      user_role: userRole,
      email: user.email,
      permissions,
      shop_info: {
        id: shopDetails.id,
        name: shopDetails.name,
        status: shopDetails.status,
        description: shopDetails.description,
        address: shopDetails.address,
        phone: shopDetails.phone,
        website: shopDetails.website,
        opening_hours: shopDetails.opening_hours,
        loyalty_type: shopDetails.loyalty_type,
      },
      subscription_info: {
        customer_id: shopDetails.customers[0].id,
        customer_name: shopDetails.customers[0].name,
        subscription_tier: shopDetails.customers[0].subscription_tier,
        customer_type: shopDetails.customers[0].type,
      },
    };

    return c.json(
      standardResponse(
        200,
        "Shop owner profile retrieved successfully",
        profileData
      )
    );
  } catch (error) {
    logger.error("Error fetching shop owner profile:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

export default shop;
