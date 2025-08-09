import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../config/database";
import { logger } from "../config/logger";
import { standardResponse } from "../middleware/error";
import {
  authenticateUser,
  requireAdmin,
  getUserPermissions,
  UnifiedAuthContext,
} from "../middleware/unified-auth";
import crypto from "crypto";

const admin = new OpenAPIHono<UnifiedAuthContext>();

// Apply unified auth middleware to all admin routes EXCEPT login
admin.use("*", async (c, next) => {
  // Skip auth for login endpoint
  if (c.req.path === "/api/admin/login") {
    await next();
    return;
  }

  // Apply auth to all other routes
  await authenticateUser(c, next);
});

admin.use("*", async (c, next) => {
  // Skip admin requirement for login endpoint
  if (c.req.path === "/api/admin/login") {
    await next();
    return;
  }

  // Require admin for all other routes
  await requireAdmin(c, next);
});

// ===========================
// CLEAN ADMIN API - ONLY 5 ESSENTIAL ENDPOINTS
// ===========================

// SCHEMAS
const customerResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  subscription_tier: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
});

const completeOnboardingSchema = z.object({
  invitation_token: z.string().min(1, "Invitation token required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  shop_details: z
    .object({
      description: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      website: z.string().url().optional(),
      opening_hours: z.string().optional(),
      loyalty_type: z.enum(["points", "coupons"]).default("points"),
      tag: z.string().optional(),
    })
    .optional(),
});

// Primary onboarding schema - only 7 required fields
const simpleB2bOnboardingSchema = z.object({
  business_name: z.string().min(1, "Business name is required"),
  contact_email: z.string().email("Valid email is required"),
  contact_phone: z.string().optional(),
  owner_email: z.string().email("Valid owner email is required"),
  owner_first_name: z.string().min(1, "Owner first name is required"),
  owner_last_name: z.string().min(1, "Owner last name is required"),
  pos_provider_name: z.string().min(1, "POS provider is required"),
  // Optional fields with smart defaults
  customer_type: z.enum(["platform", "enterprise"]).default("platform"),
  subscription_tier: z
    .enum(["basic", "premium", "enterprise"])
    .default("basic"),
  loyalty_type: z.enum(["points", "coupons"]).default("points"),
});

// ===========================
// 1. SIMPLIFIED B2B ONBOARDING (PRIMARY ENDPOINT)
// ===========================

const simpleB2bOnboardingRoute = createRoute({
  method: "post",
  path: "/onboard-simple",
  summary: "🚀 Simple B2B onboarding (RECOMMENDED)",
  description: `
**The primary endpoint for B2B customer onboarding.**

Creates customer, shop, and invitation in one API call with smart defaults.
Requires only 7 fields instead of 15+. Perfect for sales teams and admin dashboards.

**Smart Defaults Applied:**
- \`customer_type\`: "platform" 
- \`subscription_tier\`: "basic"
- \`loyalty_type\`: "points"
- \`shop_name\`: Same as business_name
- \`shop_status\`: "pending"

**Authentication:** Requires admin JWT token in Authorization header.

**Example:**
\`\`\`bash
curl -X POST /api/admin/onboard-simple \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "business_name": "Coffee Shop",
    "contact_email": "contact@coffeeshop.com",
    "owner_email": "owner@coffeeshop.com",
    "owner_first_name": "John",
    "owner_last_name": "Smith",
    "pos_provider_name": "Square"
  }'
\`\`\`
  `,
  tags: ["Admin"],
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: simpleB2bOnboardingSchema.openapi({
            example: {
              business_name: "Coffee Shop Downtown",
              contact_email: "contact@coffeeshop.com",
              contact_phone: "+1-555-0100",
              owner_email: "owner@coffeeshop.com",
              owner_first_name: "John",
              owner_last_name: "Smith",
              pos_provider_name: "Square",
              customer_type: "platform",
              subscription_tier: "basic",
              loyalty_type: "points",
            },
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "B2B onboarding completed successfully",
      content: {
        "application/json": {
          schema: z
            .object({
              success: z.boolean(),
              message: z.string(),
              data: z.object({
                customer_id: z.string().uuid(),
                shop_id: z.string().uuid(),
                invitation_id: z.string().uuid(),
                invitation_token: z.string(),
                setup_url: z.string(),
              }),
            })
            .openapi({
              example: {
                success: true,
                message: "B2B onboarding completed successfully",
                data: {
                  customer_id: "123e4567-e89b-12d3-a456-426614174000",
                  shop_id: "456e7890-e89b-12d3-a456-426614174001",
                  invitation_id: "789e0123-e89b-12d3-a456-426614174002",
                  invitation_token: "abc123def456...",
                  setup_url: "http://localhost:3000/setup/abc123def456...",
                },
              },
            }),
        },
      },
    },
    401: {
      description: "Authentication required",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("Admin authentication required"),
          }),
        },
      },
    },
    403: {
      description: "Admin access required",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean().default(false),
            message: z.string().default("Admin access required"),
          }),
        },
      },
    },
  },
});

admin.openapi(simpleB2bOnboardingRoute, async (c) => {
  try {
    const adminUser = c.get("adminUser");
    const data = c.req.valid("json");

    // 1. Find or create POS provider
    let { data: posProvider, error: posProviderError } = await supabase
      .from("pos_providers")
      .select("id")
      .eq("name", data.pos_provider_name)
      .single();

    if (posProviderError || !posProvider) {
      const { data: newPosProvider, error: createPosError } = await supabase
        .from("pos_providers")
        .insert({
          name: data.pos_provider_name,
          description: `Auto-created for ${data.business_name}`,
        })
        .select("id")
        .single();

      if (createPosError) throw createPosError;
      posProvider = newPosProvider;
    }

    // 2. Create B2B customer with smart defaults
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .insert({
        name: data.business_name,
        type: data.customer_type,
        subscription_tier: data.subscription_tier,
        settings: {
          contact_email: data.contact_email,
          contact_phone: data.contact_phone,
          created_via: "simple_onboarding",
          created_by_admin: adminUser.id,
        },
      })
      .select()
      .single();

    if (customerError) throw customerError;

    // 3. Create shop with smart defaults
    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .insert({
        customer_id: customer.id,
        pos_provider_id: posProvider.id,
        name: data.business_name, // Use business name as shop name
        email: data.contact_email,
        phone: data.contact_phone,
        loyalty_type: data.loyalty_type,
        points_per_euro: data.loyalty_type === "points" ? 100 : null, // 100 points per euro default
        status: "pending",
        settings: {
          created_via: "simple_onboarding",
        },
      })
      .select()
      .single();

    if (shopError) throw shopError;

    // 4. Create invitation token
    const invitationToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    const { data: invitation, error: invitationError } = await supabase
      .from("shop_owner_invitations")
      .insert({
        shop_id: shop.id,
        email: data.owner_email,
        first_name: data.owner_first_name,
        last_name: data.owner_last_name,
        phone: data.contact_phone,
        invitation_token: invitationToken,
        expires_at: expiresAt.toISOString(),
        invited_by_admin: adminUser.id,
      })
      .select()
      .single();

    if (invitationError) throw invitationError;

    // 5. Generate setup URL
    const setupUrl = `${
      process.env.FRONTEND_URL || "http://localhost:3001"
    }/setup/${invitationToken}`;

    // Note: Email sending is disabled for now - admin can copy the setup URL from response
    logger.info(
      `Simple B2B onboarding completed: ${customer.id} -> ${shop.id}`
    );
    logger.info(`Setup URL for ${data.owner_email}: ${setupUrl}`);

    return c.json(
      standardResponse(201, "B2B onboarding completed successfully", {
        customer_id: customer.id,
        shop_id: shop.id,
        invitation_id: invitation.id,
        invitation_token: invitationToken,
        setup_url: setupUrl,
      }),
      201
    );
  } catch (error) {
    logger.error("Error in simple B2B onboarding:", error);
    return c.json(
      standardResponse(500, "Failed to complete B2B onboarding"),
      500
    );
  }
});

// ===========================
// 2. LIST ALL CUSTOMERS (for admin dashboard)
// ===========================

const getCustomersRoute = createRoute({
  method: "get",
  path: "/customers",
  summary: "📋 List all customers",
  description: `
Retrieves all B2B customers for admin dashboard.
Supports filtering and pagination.

**Authentication:** Requires admin JWT token in Authorization header.
  `,
  tags: ["Admin"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      limit: z.string().optional(),
      offset: z.string().optional(),
      type: z.enum(["platform", "enterprise"]).optional(),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Customers retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(customerResponseSchema),
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

admin.openapi(getCustomersRoute, async (c) => {
  try {
    const { limit = "50", offset = "0", type, search } = c.req.valid("query");

    let query = supabase
      .from("customers")
      .select("id, name, type, subscription_tier, is_active, created_at", {
        count: "exact",
      });

    if (type) query = query.eq("type", type);
    if (search) query = query.ilike("name", `%${search}%`);

    const {
      data: customers,
      error,
      count,
    } = await query
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      logger.error("Failed to fetch customers:", error);
      return c.json(standardResponse(500, "Failed to fetch customers"), 500);
    }

    return c.json({
      success: true,
      message: "Customers retrieved successfully",
      data: customers,
      meta: {
        total: count || 0,
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    logger.error("Error fetching customers:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// ===========================
// 3. LIST POS PROVIDERS (for dropdowns)
// ===========================

const getPosProvidersRoute = createRoute({
  method: "get",
  path: "/pos-providers",
  summary: "🔌 List POS providers",
  description: `
Retrieves all available POS providers for admin dropdowns.
Used when creating shops to select POS integration.

**Authentication:** Requires admin JWT token in Authorization header.
  `,
  tags: ["Admin"],
  security: [{ BearerAuth: [] }],
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

// ===========================
// 4. COMPLETE SHOP SETUP (used by shop owners - NO AUTH)
// ===========================

const completeShopSetupRoute = createRoute({
  method: "post",
  path: "/complete-shop-setup",
  summary: "✅ Complete shop owner setup",
  description: `
**Public endpoint** used by shop owners to complete their setup process.

Creates Supabase Auth account and completes shop owner profile.
Shop remains in "pending" status until POS company enables it.
Shop owners access this via the setup URL sent in invitation email.

**No authentication required** - uses invitation token for security.
  `,
  tags: ["Public"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: completeOnboardingSchema.openapi({
            example: {
              invitation_token: "abc123def456...",
              password: "SecurePassword123!",
              shop_details: {
                description: "Premium coffee and pastries",
                address: "123 Main Street, Downtown",
                phone: "+1-555-0125",
                website: "https://myshop.com",
                opening_hours: "Mon-Fri: 7:00-19:00, Sat-Sun: 8:00-18:00",
                loyalty_type: "points",
              },
            },
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Shop setup completed successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              shop: z.object({
                id: z.string().uuid(),
                name: z.string(),
                status: z.string(),
              }),
              user: z.object({
                id: z.string(),
                email: z.string(),
              }),
              dashboard_url: z.string(),
            }),
          }),
        },
      },
    },
  },
});

// Remove auth for this specific endpoint
const completeShopSetupHandler = new OpenAPIHono();
completeShopSetupHandler.openapi(completeShopSetupRoute, async (c) => {
  try {
    const setupData = c.req.valid("json");

    // Step 1: Verify invitation token
    const { data: invitation, error: invitationError } = await supabase
      .from("shop_owner_invitations")
      .select(
        `
        id, shop_id, email, first_name, last_name, phone, expires_at, status,
        shops!inner (
          id, name, customer_id, status, email
        )
      `
      )
      .eq("invitation_token", setupData.invitation_token)
      .eq("status", "pending")
      .single();

    if (invitationError || !invitation) {
      return c.json(
        standardResponse(404, "Invalid or expired invitation token"),
        404
      );
    }

    // Check if invitation is expired
    if (new Date(invitation.expires_at) < new Date()) {
      return c.json(standardResponse(400, "Invitation token has expired"), 400);
    }

    // Step 2: Create Supabase Auth user
    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email: invitation.email,
        password: setupData.password,
        email_confirm: true, // Skip email confirmation for B2B users
        user_metadata: {
          first_name: invitation.first_name,
          last_name: invitation.last_name,
          phone: invitation.phone,
          shop_id: invitation.shop_id,
          role: "shop_owner",
        },
      });

    if (authError) {
      logger.error("Failed to create Supabase Auth user:", authError);
      return c.json(
        standardResponse(500, "Failed to create user account"),
        500
      );
    }

    // Step 3: Update Shop Details (if provided)
    let updateData: any = {
      // Keep status as "pending" - only POS companies can activate shops
      owner_user_id: authUser.user.id, // Link to Supabase Auth user
    };

    if (setupData.shop_details) {
      updateData = { ...updateData, ...setupData.shop_details };
    }

    const { data: updatedShop, error: shopUpdateError } = await supabase
      .from("shops")
      .update(updateData)
      .eq("id", invitation.shop_id)
      .select()
      .single();

    if (shopUpdateError) {
      logger.error("Failed to update shop:", shopUpdateError);
      return c.json(standardResponse(500, "Failed to update shop"), 500);
    }

    // Step 4: Mark invitation as completed
    await supabase
      .from("shop_owner_invitations")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        user_id: authUser.user.id,
      })
      .eq("id", invitation.id);

    const dashboardUrl = `${
      process.env.FRONTEND_URL || "https://your-frontend.com"
    }/dashboard`;

    logger.info(
      `Shop setup completed for shop: ${updatedShop.name}, user: ${authUser.user.email}`
    );
    return c.json(
      standardResponse(200, "Shop setup completed successfully", {
        shop: {
          id: updatedShop.id,
          name: updatedShop.name,
          status: updatedShop.status,
        },
        user: {
          id: authUser.user.id,
          email: authUser.user.email,
        },
        dashboard_url: dashboardUrl,
      })
    );
  } catch (error) {
    logger.error("Error completing shop setup:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Mount the no-auth handler to admin
admin.route("", completeShopSetupHandler);

// ===========================
// 5. GET INVITATION DETAILS (for setup page - NO AUTH)
// ===========================

const getInvitationRoute = createRoute({
  method: "get",
  path: "/invitation/{token}",
  summary: "📧 Get invitation details",
  description: `
**Public endpoint** to get invitation details for the shop setup page.

Shop owners use this to view invitation details before completing setup.
**No authentication required** - uses invitation token for security.
  `,
  tags: ["Public"],
  request: {
    params: z.object({
      token: z.string().min(1, "Token is required"),
    }),
  },
  responses: {
    200: {
      description: "Invitation details retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              shop_name: z.string(),
              customer_name: z.string(),
              owner_name: z.string(),
              email: z.string(),
              expires_at: z.string(),
              is_expired: z.boolean(),
            }),
          }),
        },
      },
    },
  },
});

// Remove auth for this specific endpoint
const getInvitationHandler = new OpenAPIHono();
getInvitationHandler.openapi(getInvitationRoute, async (c) => {
  try {
    const { token } = c.req.valid("param");

    const { data: invitation, error } = await supabase
      .from("shop_owner_invitations")
      .select("email, first_name, last_name, expires_at, status, shop_id")
      .eq("invitation_token", token)
      .eq("status", "pending")
      .single();

    if (error || !invitation) {
      return c.json(standardResponse(404, "Invitation not found"), 404);
    }

    // Get shop and customer details separately to avoid TypeScript issues
    const { data: shopData, error: shopError } = await supabase
      .from("shops")
      .select("name, customer_id")
      .eq("id", invitation.shop_id)
      .single();

    if (shopError || !shopData) {
      return c.json(standardResponse(404, "Shop not found"), 404);
    }

    const { data: customerData, error: customerError } = await supabase
      .from("customers")
      .select("name")
      .eq("id", shopData.customer_id)
      .single();

    if (customerError || !customerData) {
      return c.json(standardResponse(404, "Customer not found"), 404);
    }

    const isExpired = new Date(invitation.expires_at) < new Date();

    return c.json(
      standardResponse(200, "Invitation details retrieved successfully", {
        shop_name: shopData.name,
        customer_name: customerData.name,
        owner_name: `${invitation.first_name} ${invitation.last_name}`,
        email: invitation.email,
        expires_at: invitation.expires_at,
        is_expired: isExpired,
      })
    );
  } catch (error) {
    logger.error("Error fetching invitation:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

// Mount the no-auth handler to admin
admin.route("", getInvitationHandler);

// ===========================
// 6. AUTHENTICATION & TESTING ENDPOINTS
// ===========================

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password required"),
});

const loginRoute = createRoute({
  method: "post",
  path: "/login",
  summary: "🔐 Login and get JWT token",
  description: `
**Login endpoint to get JWT token for API testing.**

This endpoint allows you to sign in with any user (admin, shop owner, or customer) 
and get their JWT token to use in other API endpoints.

**Perfect for API testing in Scalar!**

**No authentication required** - this is the login endpoint.
  `,
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: loginSchema.openapi({
            example: {
              email: "admin@company.com",
              password: "your-password",
            },
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Login successful",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              user: z.object({
                id: z.string(),
                email: z.string(),
                user_type: z.string(),
                user_role: z.string(),
              }),
              jwt_token: z.string(),
              expires_at: z.string(),
              usage_instructions: z.object({
                authorization_header: z.string(),
                example_request: z.string(),
              }),
            }),
          }),
        },
      },
    },
    401: {
      description: "Invalid credentials",
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

// Remove auth for this specific endpoint
const loginHandler = new OpenAPIHono();
loginHandler.openapi(loginRoute, async (c) => {
  try {
    const { email, password } = c.req.valid("json");

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      logger.warn(`Failed login attempt for: ${email}`);
      return c.json(standardResponse(401, "Invalid email or password"), 401);
    }

    const user = data.user;
    const session = data.session;

    // Determine user type and role
    let userType = "unknown";
    let userRole = "unknown";
    let userInfo: any = {};

    // Check if user is admin
    const { data: adminUser } = await supabase
      .from("admin_users")
      .select("id, role, first_name, last_name, is_active")
      .eq("supabase_user_id", user.id)
      .eq("is_active", true)
      .single();

    if (adminUser) {
      userType = "admin";
      userRole = adminUser.role;
      userInfo = {
        admin_id: adminUser.id,
        first_name: adminUser.first_name,
        last_name: adminUser.last_name,
      };
    } else {
      // Check if user is shop owner
      const { data: shop } = await supabase
        .from("shops")
        .select("id, name, status")
        .eq("owner_user_id", user.id)
        .eq("status", "active")
        .single();

      if (shop) {
        userType = "shop_owner";
        userRole = "shop_owner";
        userInfo = {
          shop_id: shop.id,
          shop_name: shop.name,
        };
      } else {
        // Check if user is app user (customer)
        const { data: appUser } = await supabase
          .from("app_users")
          .select("id, first_name, last_name, is_verified")
          .eq("email", user.email)
          .eq("is_verified", true)
          .single();

        if (appUser) {
          userType = "app_user";
          userRole = "customer";
          userInfo = {
            app_user_id: appUser.id,
            first_name: appUser.first_name,
            last_name: appUser.last_name,
          };
        }
      }
    }

    logger.info(`Successful login: ${email} (${userType})`);

    return c.json(
      standardResponse(200, "Login successful", {
        user: {
          id: user.id,
          email: user.email,
          user_type: userType,
          user_role: userRole,
          ...userInfo,
        },
        jwt_token: session.access_token,
        expires_at: session.expires_at,
        usage_instructions: {
          authorization_header: `Bearer ${session.access_token}`,
          example_request:
            "Copy the jwt_token above and use it in Authorization header for other API calls",
          scalar_usage: "In Scalar, click 'Authorize' and paste the jwt_token",
        },
      })
    );
  } catch (error) {
    logger.error("Error during login:", error);
    return c.json(standardResponse(500, "Login failed"), 500);
  }
});

// Mount the no-auth handler to admin
admin.route("", loginHandler);

const createTestCustomerSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  first_name: z.string().min(1, "First name required"),
  last_name: z.string().min(1, "Last name required"),
  phone: z.string().optional(),
  initial_points: z.number().min(0).default(10000),
});

const createTestCustomerRoute = createRoute({
  method: "post",
  path: "/testing/create-test-customer",
  summary: "🧪 Create test customer for POS testing",
  description: `
**Create a test customer with Supabase Auth account and loyalty points.**

This endpoint is designed for POS engineers to create test customers they can use
to test the coupon activation flow. Creates both Supabase Auth user and app_users record.

**Authentication:** Requires admin JWT token in Authorization header.
  `,
  tags: ["Admin"],
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createTestCustomerSchema.openapi({
            example: {
              email: "testcustomer@example.com",
              password: "TestPassword123!",
              first_name: "Test",
              last_name: "Customer",
              phone: "+1234567890",
              initial_points: 10000,
            },
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Test customer created successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              customer: z.object({
                id: z.string().uuid(),
                email: z.string(),
                supabase_user_id: z.string(),
              }),
              test_jwt_token: z.string(),
              loyalty_accounts: z.array(
                z.object({
                  shop_id: z.string().uuid(),
                  shop_name: z.string(),
                  points_balance: z.number(),
                })
              ),
            }),
          }),
        },
      },
    },
  },
});

admin.openapi(createTestCustomerRoute, async (c) => {
  try {
    const adminUser = c.get("adminUser");
    const customerData = c.req.valid("json");

    // 1. Create Supabase Auth user
    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email: customerData.email,
        password: customerData.password,
        email_confirm: true, // Skip email confirmation for test users
        user_metadata: {
          first_name: customerData.first_name,
          last_name: customerData.last_name,
          phone: customerData.phone,
          role: "customer",
          is_test_user: true,
        },
      });

    if (authError) {
      logger.error("Failed to create Supabase Auth user:", authError);
      return c.json(
        standardResponse(
          500,
          `Failed to create auth user: ${authError.message}`
        ),
        500
      );
    }

    // 2. Create app_users record
    const { data: appUser, error: appUserError } = await supabase
      .from("app_users")
      .insert({
        email: customerData.email,
        phone_number: customerData.phone,
        first_name: customerData.first_name,
        last_name: customerData.last_name,
        is_verified: true, // Test users are auto-verified
      })
      .select()
      .single();

    if (appUserError) {
      logger.error("Failed to create app user:", appUserError);
      // Clean up auth user if app user creation fails
      await supabase.auth.admin.deleteUser(authUser.user.id);
      return c.json(
        standardResponse(
          500,
          `Failed to create app user: ${appUserError.message}`
        ),
        500
      );
    }

    // 3. Create loyalty accounts for all active shops
    const { data: activeShops } = await supabase
      .from("shops")
      .select("id, name, loyalty_programs(id)")
      .eq("status", "active")
      .limit(10); // Limit to first 10 shops for testing

    const loyaltyAccounts: Array<{
      shop_id: string;
      shop_name: string;
      points_balance: number;
    }> = [];

    if (activeShops && activeShops.length > 0) {
      for (const shop of activeShops) {
        if (shop.loyalty_programs && shop.loyalty_programs.length > 0) {
          const { data: loyaltyAccount } = await supabase
            .from("customer_loyalty_accounts")
            .insert({
              app_user_id: appUser.id,
              shop_id: shop.id,
              loyalty_program_id: shop.loyalty_programs[0].id,
              points_balance: customerData.initial_points,
              total_points_earned: customerData.initial_points,
            })
            .select()
            .single();

          if (loyaltyAccount) {
            loyaltyAccounts.push({
              shop_id: shop.id,
              shop_name: shop.name,
              points_balance: customerData.initial_points,
            });
          }
        }
      }
    }

    // 4. Generate a test JWT token that POS engineers can use
    // Note: For testing, POS engineers should use Supabase client to sign in and get JWT token
    let testJwtToken =
      "Please use Supabase client to sign in with the credentials above to get JWT token";

    // Alternative: Generate a session for the user (if needed for immediate testing)
    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.admin.generateLink({
          type: "recovery",
          email: customerData.email,
          options: {
            redirectTo: "http://localhost:3000/auth/callback",
          },
        });

      if (sessionData && !sessionError) {
        // Note: This doesn't give us the JWT directly, so we provide instructions instead
        testJwtToken = `Use these credentials to sign in via Supabase client: ${customerData.email} / ${customerData.password}`;
      }
    } catch (error) {
      logger.warn("Could not generate session link:", error);
    }

    logger.info(
      `Test customer created: ${appUser.email} by admin: ${adminUser.id}`
    );

    return c.json(
      standardResponse(201, "Test customer created successfully", {
        customer: {
          id: appUser.id,
          email: appUser.email,
          supabase_user_id: authUser.user.id,
        },
        test_jwt_token: testJwtToken,
        loyalty_accounts: loyaltyAccounts,
        usage_instructions: {
          login: `Use email: ${customerData.email}, password: ${customerData.password}`,
          api_testing: "Use the test_jwt_token in Authorization: Bearer header",
          points_available: customerData.initial_points,
        },
      }),
      201
    );
  } catch (error) {
    logger.error("Error creating test customer:", error);
    return c.json(standardResponse(500, "Failed to create test customer"), 500);
  }
});

// ===========================
// 7. ADMIN PROFILE ENDPOINT
// ===========================

const adminProfileRoute = createRoute({
  method: "get",
  path: "/profile",
  summary: "👤 Get admin profile",
  description: `
**Admin profile endpoint** returns admin-specific profile information.

Returns admin permissions, role info, and admin-specific data.
**Authentication:** Requires admin JWT token in Authorization header.
  `,
  tags: ["Admin"],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: "Admin profile retrieved successfully",
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
              admin_info: z.object({
                id: z.string(),
                first_name: z.string(),
                last_name: z.string(),
                role: z.string(),
              }),
              shop_info: z
                .object({
                  id: z.string(),
                  name: z.string(),
                  status: z.string(),
                })
                .optional(),
            }),
          }),
        },
      },
    },
  },
});

admin.openapi(adminProfileRoute, async (c) => {
  try {
    const userType = c.get("userType");
    const userRole = c.get("userRole");
    const user = c.get("user");
    const adminUser = c.get("adminUser");
    const shop = c.get("shop");

    const permissions = getUserPermissions(userType, userRole);

    const profileData: any = {
      user_type: userType,
      user_role: userRole,
      email: user.email,
      permissions,
      admin_info: {
        id: adminUser.id,
        first_name: adminUser.first_name,
        last_name: adminUser.last_name,
        role: adminUser.role,
      },
    };

    // Include shop info if admin has shop access
    if (shop) {
      profileData.shop_info = {
        id: shop.id,
        name: shop.name,
        status: shop.status,
      };
    }

    return c.json(
      standardResponse(200, "Admin profile retrieved successfully", profileData)
    );
  } catch (error) {
    logger.error("Error fetching admin profile:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});

export default admin;
