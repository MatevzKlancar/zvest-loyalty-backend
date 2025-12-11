import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { apiReference } from "@scalar/hono-api-reference";
import { OpenAPIHono } from "@hono/zod-openapi";

import { logger } from "./config/logger";
import { env } from "./config/env";

// Import route modules
import adminRoutes from "./routes/admin";
import posRoutes from "./routes/pos";
import appRoutes from "./routes/app";
import shopAdminRoutes from "./routes/shop-admin";
import publicRoutes from "./routes/public";
// DatabaseSeeder import removed

// Import reservation module routes
import {
  shopAdminReservationRoutes,
  publicReservationRoutes,
  appUserReservationRoutes,
} from "./modules/reservations";

const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          success: false,
          message: "Validation failed",
          errors: result.error.flatten(),
        },
        400
      );
    }
  },
});

// Middleware
app.use("*", cors());
app.use("*", honoLogger());

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "2.0.0",
  });
});

// Register security schemes
app.openAPIRegistry.registerComponent("securitySchemes", "ApiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
  description: "API Key for POS provider authentication",
});

app.openAPIRegistry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "JWT Bearer token from Supabase Auth for shop owners",
});

// API Documentation
app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: {
    version: "3.0.0",
    title: "Zvest Loyalty Platform API",
    description: `
# Complete Loyalty Platform API

This API provides a comprehensive loyalty platform solution with unified authentication, role-based access control, and streamlined B2B onboarding.

## Overview

The Zvest Loyalty Platform enables businesses to implement loyalty programs with minimal integration effort. The platform features a unified dashboard for both platform administrators and shop owners, with role-based access control for security.

## Key Features

- **🔐 Unified Authentication**: Single dashboard for admins and shop owners with role-based access
- **🚀 Simplified B2B Onboarding**: One-step customer and shop creation with smart defaults
- **📧 Automated Setup Flow**: Token-based invitations with secure setup process
- **🏪 Shop Management**: Complete business dashboard for shop owners
- **🎟️ Coupon Management**: Full CRUD operations with points-based rewards
- **📊 Analytics Dashboard**: Real-time transaction and revenue insights
- **🔌 Smart POS Integration**: Business-logic-friendly error handling for seamless POS integration
- **📱 Mobile App Support**: Customer-facing endpoints for point redemption

## 🎯 POS Integration Highlights

**Business-Logic-Friendly Error Handling**: Unlike traditional APIs that return HTTP 400 for business rules (expired coupons, invalid codes), our POS endpoints return HTTP 200 with structured error details. This makes integration much simpler:

- ✅ **No complex error handling needed** - all responses follow the same pattern
- ✅ **Clear error messages for staff** - "This coupon expired on January 15, 2024"  
- ✅ **Specific error codes for different scenarios** - \`coupon_expired\`, \`invalid_format\`, etc.
- ✅ **Consistent response structure** - always check \`data.valid\` first

## Authentication

**Admin and Shop Management endpoints** require JWT authentication:
- **Required Header**: \`Authorization: Bearer YOUR_JWT_TOKEN\`
- Obtain tokens via Supabase Auth login
- Role-based access: admins see all data, shop owners see only their data

**POS Integration endpoints** use API Key authentication:
- **Required Header**: \`x-api-key: your-pos-api-key\`
- Generate API keys using: \`bun run scripts/generate-api-keys.ts\`
- Configure in environment: \`POS_PROVIDERS="Provider Name:api-key"\`

**Public endpoints** (invitation setup) require no authentication.

## POS Error Handling

**Business Logic vs Technical Errors**: Our POS endpoints use a hybrid approach for optimal integration:

**✅ Business Logic Errors → HTTP 200 OK**
- Expired coupons, invalid codes, insufficient points
- Always returns \`{ success: true, data: { valid: false, error_code: "...", error_message: "..." } }\`
- POS systems can handle uniformly without complex error handling

**❌ Technical Errors → HTTP 4xx/5xx**  
- Invalid API keys (401), malformed requests (400), server errors (500)
- Indicates actual integration problems requiring different handling

\`\`\`javascript
// Example: POS Coupon Validation
const response = await fetch('/api/pos/coupons/validate', {
  method: 'POST',
  headers: { 'x-api-key': 'your-key', 'Content-Type': 'application/json' },
  body: JSON.stringify({ shop_id: 'uuid', redemption_id: '123456' })
});

const data = await response.json();

if (response.ok && data.success) {
  if (data.data.valid) {
    // ✅ Valid coupon - apply discount
    applyCouponDiscount(data.data.coupon);
  } else {
    // ⚠️ Business rule error - show to staff
    showMessage(data.data.error_message); // "Coupon expired on January 15, 2024"
  }
} else {
  // ❌ Technical error - system issue
  handleSystemError(response.status);
}
\`\`\`

## Quick Start Flow

### 1. Admin Creates B2B Customer (One Step)
\`\`\`bash
POST /api/admin/onboard-simple
Authorization: Bearer YOUR_ADMIN_JWT
{
  "business_name": "Coffee Shop",
  "contact_email": "contact@coffeeshop.com", 
  "owner_email": "owner@coffeeshop.com",
  "owner_first_name": "John",
  "owner_last_name": "Smith",
  "pos_provider_name": "Square"
}
\`\`\`

### 2. Shop Owner Completes Setup
\`\`\`bash
POST /api/admin/complete-shop-setup
{
  "invitation_token": "abc123...",
  "password": "SecurePassword123!",
  "shop_details": { "opening_hours": "9-5", "website": "..." }
}
\`\`\`

### 3. Shop Owner Manages Business
\`\`\`bash
GET /api/shop-admin/shop
Authorization: Bearer SHOP_OWNER_JWT
\`\`\`

### 4. POS Integration
\`\`\`bash
POST /api/pos/transactions
x-api-key: your-pos-api-key
\`\`\`

## Role-Based Access

- **Platform Admins**: Create customers, view all shops, system-wide analytics
- **Shop Owners**: Manage their shop, coupons, view their analytics
- **POS Systems**: Create transactions, sync menu items
- **Customers**: Scan QR codes, redeem points (mobile app)
`,
    contact: {
      name: "Zvest Support",
      email: "support@zvest.com",
    },
    license: {
      name: "MIT",
    },
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Development - Local server",
    },
    {
      url: "https://zvest-loyalty-backend.onrender.com",
      description: "Production - Live server",
    },
  ],
  tags: [
    {
      name: "Admin",
      description:
        "🔧 Platform administration endpoints. B2B onboarding, customer management, and system configuration. Requires admin authentication.",
    },
    {
      name: "Public",
      description:
        "🌐 Public endpoints including shop owner setup and store directory. Browse stores, view store details, get available coupons, and complete shop setup. No authentication required.",
    },
    {
      name: "Shop Management",
      description:
        "🏪 Complete shop owner business dashboard. Manage shop settings, coupons, analytics, and business operations. Requires shop owner authentication.",
    },
    {
      name: "POS Integration",
      description:
        "🔌 Point-of-sale system integration endpoints. Connect POS systems, sync menu items, and process transactions. Requires POS API key.",
    },
    {
      name: "Customer App",
      description:
        "📱 Complete customer mobile app experience. Scan QR codes, manage loyalty points, view transactions, redeem coupons, and manage profile. Public access with email/phone identification.",
    },
    {
      name: "Shop Admin - Reservations",
      description:
        "📅 Reservation system management for shop owners. Create services, manage staff/resources, set availability schedules, handle bookings, and track no-shows. Requires shop owner authentication.",
    },
    {
      name: "Public - Reservations",
      description:
        "🗓️ Public reservation endpoints. Browse available services, check time slots, and make guest reservations. No authentication required.",
    },
    {
      name: "App User - Reservations",
      description:
        "📱 Reservation management for app users. View upcoming reservations, book appointments, and cancel bookings. Requires app user authentication.",
    },
  ],
});

// Scalar API Documentation (primary docs)
app.get(
  "/api/docs",
  apiReference({
    theme: "saturn",
    spec: { url: "/api/openapi.json" },
    metaData: {
      title: "Zvest Loyalty Platform API",
      description:
        "Complete loyalty platform with POS integration and customer app",
      ogDescription:
        "Comprehensive loyalty platform API for seamless POS integration",
      ogTitle: "Zvest Loyalty Platform API Documentation",
    },
    searchHotKey: "k",
    customCss: `
      /* Highlight POS Integration section */
      .scalar-api-reference [data-section-id*="pos"] {
        border-left: 4px solid #10b981;
        padding-left: 1rem;
        background: rgba(16, 185, 129, 0.05);
      }
      
      /* Style error code tables */
      .scalar-api-reference table {
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }
      
      /* Highlight success responses */
      .scalar-api-reference [data-status="200"] {
        border-left: 3px solid #10b981;
      }
      
      /* Style error examples */
      .scalar-api-reference .example-section {
        border-radius: 6px;
        margin: 0.5rem 0;
      }
    `,
    showSidebar: true,
    hideDownloadButton: false,
    hideTestRequestButton: false,
  })
);

// Route mounting with clear organization
// Admin routes - unified authentication with role-based access
app.route("/api/admin", adminRoutes);

// Shop Admin routes - for shop owner business dashboard
app.route("/api/shop-admin", shopAdminRoutes);

// New shop routes - for shop-specific endpoints
import shopRoutes from "./routes/shop";
app.route("/api/shop", shopRoutes);

// New app-user routes - for B2C app user endpoints
import appUserRoutes from "./routes/app-user";
app.route("/api/app-user", appUserRoutes);

// Public routes - for public store APIs (no authentication required)
app.route("/api/public", publicRoutes);

// POS routes - for point-of-sale system integration
app.route("/api/pos", posRoutes);

// App routes - for customer mobile application
app.route("/api/app", appRoutes);

// Reservation module routes
app.route("/api/shop-admin/reservations", shopAdminReservationRoutes);
app.route("/api/public/reservations", publicReservationRoutes);
app.route("/api/app-user/reservations", appUserReservationRoutes);

// Profile endpoints now organized by user role:
// - GET /api/admin/profile (admin permissions, role info, admin-specific data)
// - GET /api/shop/profile (shop details, subscription info, shop-specific data)
// - GET /api/app-user/profile (loyalty points, transaction history, user preferences)

// Root endpoint with updated API overview
app.get("/", (c) => {
  return c.json({
    name: "Zvest Loyalty Platform API",
    version: "3.0.0",
    description:
      "Complete loyalty platform with unified authentication and role-based access",
    endpoints: {
      documentation: "/api/docs",
      openapi: "/api/openapi.json",
      health: "/health",
    },
    api_groups: {
      admin: "/api/admin - B2B customer management (requires admin auth)",
      shop_admin:
        "/api/shop-admin - Shop owner business dashboard (requires shop owner auth)",
      shop: "/api/shop - Shop-specific endpoints (requires shop owner auth)",
      app_user: "/api/app-user - B2C app user endpoints (public)",
      public: "/api/public - Public store APIs (no authentication required)",
      pos: "/api/pos - POS system integration (requires API key)",
      app: "/api/app - Customer mobile app endpoints (public)",
      reservations: {
        shop_admin: "/api/shop-admin/reservations - Manage reservation system",
        public: "/api/public/reservations - Guest bookings & availability",
        app_user: "/api/app-user/reservations - User reservation management",
      },
    },
    modern_flow: {
      "1_admin_login": "Login admin via Supabase Auth",
      "2_simple_onboarding":
        "POST /api/admin/onboard-simple (One-step B2B setup)",
      "3_shop_owner_setup":
        "POST /api/admin/complete-shop-setup (Shop owner creates account)",
      "4_shop_dashboard":
        "Shop owner logs in and manages business via /api/shop-admin",
      "5_pos_integration": "POS system integrates via /api/pos endpoints",
      "6_customer_app": "Customers use mobile app via /api/app endpoints",
    },
    authentication: {
      admin_endpoints: "Bearer JWT token (Supabase Auth)",
      shop_endpoints: "Bearer JWT token (Supabase Auth)",
      pos_endpoints: "x-api-key header",
      app_endpoints: "No authentication required",
      setup_endpoints: "Invitation token (public)",
    },
    key_improvements: {
      unified_auth: "Single authentication system for admins and shop owners",
      role_based_access: "Same endpoints, different data based on user role",
      role_specific_profiles:
        "GET /api/admin/profile, /api/shop/profile, /api/app-user/profile",
      simplified_onboarding: "60% fewer required fields for B2B setup",
      secure_setup: "Token-based invitation system with expiration",
      modern_ui_ready: "Designed for React/Next.js frontend integration",
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      success: false,
      message: "Endpoint not found",
      available_endpoints: "/api/docs",
    },
    404
  );
});

// Error handler
app.onError((err, c) => {
  logger.error("Unhandled error:", err);
  return c.json(
    {
      success: false,
      message: "Internal server error",
      error: env.NODE_ENV === "development" ? err.message : undefined,
    },
    500
  );
});

// Database seeding removed - no automatic seeding on startup

// Start server
const port = env.PORT || 3000;
logger.info(`🚀 Server starting on port ${port}`);
logger.info(`📚 API Documentation: http://localhost:${port}/api/docs`);

export default {
  port,
  fetch: app.fetch,
};
