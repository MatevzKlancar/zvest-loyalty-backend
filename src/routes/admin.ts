import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";

const admin = new OpenAPIHono();

// Schemas
const createCustomerSchema = z.object({
  name: z.string().min(1, "Customer name is required"),
  type: z.enum(["platform", "enterprise"]).default("platform"),
  subscription_tier: z
    .enum(["basic", "premium", "enterprise"])
    .default("basic"),
  settings: z.record(z.any()).optional(),
});

const createShopSchema = z.object({
  customer_id: z.string().uuid("Invalid customer ID"),
  pos_provider_id: z.string().uuid("Invalid POS provider ID"),
  name: z.string().min(1, "Shop name is required"),
  description: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  type: z.string().optional(), // coffee, restaurant, retail, etc.
});

const customerResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  subscription_tier: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
});

const shopResponseSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  pos_provider_id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  type: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
});

// Create B2B Customer
const createCustomerRoute = createRoute({
  method: "post",
  path: "/customers",
  summary: "Create new B2B customer",
  description: `
Creates a new B2B customer account for platform integration. This is the first step in onboarding a business to the loyalty platform.

**Customer Types:**
- \`platform\`: Uses shared database instance (recommended for smaller businesses)
- \`enterprise\`: Uses dedicated database instance (for large-scale operations)

**Subscription Tiers:**
- \`basic\`: Standard loyalty features
- \`premium\`: Advanced analytics and customization
- \`enterprise\`: Full white-label solution

**Example Usage:**
\`\`\`bash
curl -X POST https://zvest-loyalty-backend.onrender.com/api/admin/customers \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Coffee House Chain",
    "type": "platform",
    "subscription_tier": "premium"
  }'
\`\`\`
  `,
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createCustomerSchema.openapi({
            example: {
              name: "Coffee House Chain",
              type: "platform",
              subscription_tier: "premium",
              settings: {
                branding_color: "#8B4513",
                custom_domain: "loyalty.coffeehouse.com",
              },
            },
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Customer created successfully",
      content: {
        "application/json": {
          schema: z
            .object({
              success: z.boolean(),
              message: z.string(),
              data: customerResponseSchema,
            })
            .openapi({
              example: {
                success: true,
                message: "Customer created successfully",
                data: {
                  id: "123e4567-e89b-12d3-a456-426614174000",
                  name: "Coffee House Chain",
                  type: "platform",
                  subscription_tier: "premium",
                  is_active: true,
                  created_at: "2024-01-15T10:30:00Z",
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
                message: "Customer name is required",
              },
            }),
        },
      },
    },
    500: {
      description: "Server error processing the request",
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
                message: "Failed to create customer",
              },
            }),
        },
      },
    },
  },
});

admin.openapi(createCustomerRoute, async (c) => {
  try {
    const customerData = c.req.valid("json");

    const { data: customer, error } = await supabase
      .from("customers")
      .insert({
        name: customerData.name,
        type: customerData.type,
        subscription_tier: customerData.subscription_tier,
        settings: customerData.settings || {},
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create customer:", error);
      return c.json(standardResponse(500, "Failed to create customer"), 500);
    }

    logger.info(`Customer created successfully: ${customer.id}`);
    return c.json(
      standardResponse(201, "Customer created successfully", customer),
      201
    );
  } catch (error) {
    logger.error("Error creating customer:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Create Shop (updated - customer_id in body, not URL)
const createShopRoute = createRoute({
  method: "post",
  path: "/shops",
  summary: "Create shop for customer",
  description: "Creates a new shop for an existing B2B customer",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createShopSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Shop created successfully",
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

admin.openapi(createShopRoute, async (c) => {
  try {
    const shopData = c.req.valid("json");

    // Verify customer exists and is active
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, name, is_active")
      .eq("id", shopData.customer_id)
      .eq("is_active", true)
      .single();

    if (customerError || !customer) {
      return c.json(
        standardResponse(404, "Customer not found or inactive"),
        404
      );
    }

    // Verify POS provider exists
    const { data: posProvider, error: providerError } = await supabase
      .from("pos_providers")
      .select("id, name")
      .eq("id", shopData.pos_provider_id)
      .eq("is_active", true)
      .single();

    if (providerError || !posProvider) {
      return c.json(standardResponse(400, "Invalid POS provider"), 400);
    }

    const { data: shop, error } = await supabase
      .from("shops")
      .insert({
        customer_id: shopData.customer_id,
        pos_provider_id: shopData.pos_provider_id,
        name: shopData.name,
        description: shopData.description,
        address: shopData.address,
        phone: shopData.phone,
        email: shopData.email,
        type: shopData.type,
        status: "pending", // Will be activated when POS provider enables it
        approved_by: "admin", // In real app, get from auth context
        approved_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create shop:", error);
      return c.json(standardResponse(500, "Failed to create shop"), 500);
    }

    logger.info(
      `Shop created successfully: ${shop.id} for customer: ${customer.name} (${shopData.customer_id})`
    );
    return c.json(
      standardResponse(201, "Shop created successfully", {
        ...shop,
        customer_name: customer.name,
        pos_provider_name: posProvider.name,
      }),
      201
    );
  } catch (error) {
    logger.error("Error creating shop:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get all customers
const getCustomersRoute = createRoute({
  method: "get",
  path: "/customers",
  summary: "Get all customers",
  description: "Retrieves all B2B customers",
  tags: ["Admin"],
  responses: {
    200: {
      description: "Customers retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(customerResponseSchema),
          }),
        },
      },
    },
  },
});

admin.openapi(getCustomersRoute, async (c) => {
  try {
    const { data: customers, error } = await supabase
      .from("customers")
      .select("id, name, type, subscription_tier, is_active, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      logger.error("Failed to fetch customers:", error);
      return c.json(standardResponse(500, "Failed to fetch customers"), 500);
    }

    return c.json(
      standardResponse(200, "Customers retrieved successfully", customers)
    );
  } catch (error) {
    logger.error("Error fetching customers:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Get all POS providers (helper for admins)
const getPosProvidersRoute = createRoute({
  method: "get",
  path: "/pos-providers",
  summary: "Get all POS providers",
  description: "Retrieves all available POS providers for shop creation",
  tags: ["Admin"],
  responses: {
    200: {
      description: "POS providers retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                description: z.string().nullable(),
                is_active: z.boolean(),
              })
            ),
          }),
        },
      },
    },
  },
});

admin.openapi(getPosProvidersRoute, async (c) => {
  try {
    const { data: providers, error } = await supabase
      .from("pos_providers")
      .select("id, name, description, is_active")
      .eq("is_active", true)
      .order("name");

    if (error) {
      logger.error("Failed to fetch POS providers:", error);
      return c.json(
        standardResponse(500, "Failed to fetch POS providers"),
        500
      );
    }

    return c.json(
      standardResponse(200, "POS providers retrieved successfully", providers)
    );
  } catch (error) {
    logger.error("Error fetching POS providers:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// User-friendly shop creation with customer name
const createShopByNameSchema = z.object({
  customer_name: z.string().min(1, "Customer name is required"),
  pos_provider_name: z.string().min(1, "POS provider name is required"),
  name: z.string().min(1, "Shop name is required"),
  description: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  type: z.string().optional(),
});

const createShopByNameRoute = createRoute({
  method: "post",
  path: "/shops/by-name",
  summary: "Create shop using customer name",
  description:
    "Creates a shop using customer name instead of ID (more user-friendly)",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createShopByNameSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Shop created successfully",
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

admin.openapi(createShopByNameRoute, async (c) => {
  try {
    const shopData = c.req.valid("json");

    // Find customer by name
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, name, is_active")
      .ilike("name", shopData.customer_name) // Case-insensitive search
      .eq("is_active", true)
      .single();

    if (customerError || !customer) {
      return c.json(
        standardResponse(
          404,
          `Customer '${shopData.customer_name}' not found or inactive`
        ),
        404
      );
    }

    // Find POS provider by name
    const { data: posProvider, error: providerError } = await supabase
      .from("pos_providers")
      .select("id, name")
      .ilike("name", shopData.pos_provider_name)
      .eq("is_active", true)
      .single();

    if (providerError || !posProvider) {
      return c.json(
        standardResponse(
          400,
          `POS provider '${shopData.pos_provider_name}' not found`
        ),
        400
      );
    }

    // Create shop
    const { data: shop, error } = await supabase
      .from("shops")
      .insert({
        customer_id: customer.id,
        pos_provider_id: posProvider.id,
        name: shopData.name,
        description: shopData.description,
        address: shopData.address,
        phone: shopData.phone,
        email: shopData.email,
        type: shopData.type,
        status: "pending",
        approved_by: "admin",
        approved_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create shop:", error);
      return c.json(standardResponse(500, "Failed to create shop"), 500);
    }

    logger.info(
      `Shop created successfully: ${shop.id} for customer: ${customer.name}`
    );
    return c.json(
      standardResponse(201, "Shop created successfully", {
        ...shop,
        customer_name: customer.name,
        pos_provider_name: posProvider.name,
      }),
      201
    );
  } catch (error) {
    logger.error("Error creating shop:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

export default admin;
