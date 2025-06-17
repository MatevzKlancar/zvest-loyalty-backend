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

const app = new OpenAPIHono();

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

// API Documentation
app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: {
    version: "2.0.0",
    title: "Zvest Loyalty Platform API",
    description: `
# Complete Loyalty Platform API

This API provides a comprehensive loyalty platform solution with seamless POS integration and customer mobile app functionality.

## Overview

The Zvest Loyalty Platform enables businesses to implement loyalty programs with minimal integration effort. The platform supports both shared database instances for smaller merchants and dedicated enterprise databases for large-scale operations.

## Key Features

- **POS Integration**: Simple REST API for point-of-sale systems
- **QR Code Generation**: Automatic QR code generation for receipts
- **Mobile App Support**: Customer-facing endpoints for point redemption
- **Multi-tenant Architecture**: Support for both shared and dedicated databases
- **Real-time Points**: Instant point calculation and redemption

## Authentication

The API uses API Key authentication for POS providers:
- Include \`X-API-Key\` header in all POS requests
- Contact admin to obtain your API key

## Integration Flow

1. **Admin Setup**: Create customer and shop accounts
2. **POS Integration**: Enable shops and sync menu items
3. **Transaction Processing**: Create transactions and generate QR codes
4. **Customer Interaction**: Scan QR codes to earn loyalty points

## Getting Started

1. Start with the Admin endpoints to set up customers and shops
2. Use POS endpoints to integrate with your point-of-sale system
3. Implement QR code display on receipts
4. Use App endpoints for customer mobile app integration
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
      url:
        env.NODE_ENV === "production"
          ? "https://api.zvest.com"
          : "http://localhost:3000",
      description: env.NODE_ENV === "production" ? "Production" : "Development",
    },
  ],

  tags: [
    {
      name: "Admin",
      description:
        "Administrative endpoints for B2B customer and shop management. Used by platform administrators to onboard new customers and configure shops.",
    },
    {
      name: "POS Integration",
      description:
        "Point-of-sale system integration endpoints. These endpoints allow POS systems to connect to the loyalty platform, sync menu items, and process transactions.",
    },
    {
      name: "Customer App",
      description:
        "Customer-facing mobile app endpoints. Used by the customer mobile application to scan QR codes and redeem loyalty points.",
    },
  ],
  security: [
    {
      ApiKeyAuth: [],
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
  })
);

// Route mounting with clear organization
// Admin routes - for B2B customer management
app.route("/api/admin", adminRoutes);

// POS routes - for POS system integration
app.route("/api/pos", posRoutes);

// Customer app routes - for mobile app QR scanning
app.route("/api/app", appRoutes);

// Root endpoint with API overview
app.get("/", (c) => {
  return c.json({
    name: "Zvest Loyalty Platform API",
    version: "2.0.0",
    description: "Complete loyalty platform with POS integration",
    endpoints: {
      documentation: "/api/docs",
      openapi: "/api/openapi.json",
      health: "/health",
    },
    api_groups: {
      admin: "/api/admin - B2B customer and shop management",
      pos: "/api/pos - POS system integration",
      app: "/api/app - Customer mobile app endpoints",
    },
    flow: {
      "1_onboard_customer": "POST /api/admin/customers",
      "2a_create_shop": "POST /api/admin/shops (with customer_id)",
      "2b_create_shop_easy":
        "POST /api/admin/shops/by-name (with customer_name)",
      "3_get_shops": "GET /api/pos/shops",
      "4_enable_shop": "POST /api/pos/shops/{id}/enable",
      "5_sync_menu": "POST /api/pos/shops/{id}/articles",
      "6_create_transaction": "POST /api/pos/transactions",
      "7_get_qr_data": "GET /api/pos/transactions/{id}/qr-data",
      "8_scan_qr": "POST /api/app/scan-qr",
    },
    admin_helpers: {
      list_customers: "GET /api/admin/customers",
      list_pos_providers: "GET /api/admin/pos-providers",
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

// Start server
const port = env.PORT || 3000;
logger.info(`🚀 Server starting on port ${port}`);
logger.info(`📚 API Documentation: http://localhost:${port}/api/docs`);

export default {
  port,
  fetch: app.fetch,
};
