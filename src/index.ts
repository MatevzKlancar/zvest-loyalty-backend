import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { apiReference } from "@scalar/hono-api-reference";
import { logger } from "./config/logger";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error";
import { pos } from "./routes/pos";
import { customer } from "./routes/customer";

const app = new OpenAPIHono();

// Middleware
app.use("*", cors());

// Global error handler
app.onError(errorHandler);

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// API routes
app.route("/api/pos", pos);
app.route("/api/customers", customer);

// Add OpenAPI info
app.doc("/api-spec", {
  openapi: "3.0.0",
  info: {
    title: "Zvest POS Integration API",
    version: "1.0.0",
    description:
      "Backend API for loyalty platform with POS integration capabilities",
    contact: {
      name: "Zvest Team",
      email: "support@zvest.com",
    },
  },
  servers: [
    {
      url:
        env.NODE_ENV === "development"
          ? `http://localhost:${env.PORT}`
          : "https://api.zvest.com",
      description:
        env.NODE_ENV === "development"
          ? "Development server"
          : "Production server",
    },
  ],
  tags: [
    {
      name: "POS Integration",
      description: "APIs for POS system integration",
    },
    {
      name: "Customer App",
      description: "APIs for customer mobile application",
    },
  ],
});

// Add security scheme
app.openAPIRegistry.registerComponent("securitySchemes", "ApiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
  description: "API key for POS provider authentication",
});

// Documentation endpoint with Scalar
app.get(
  "/docs",
  apiReference({
    spec: {
      url: "/api-spec",
    },
    theme: "saturn",
    layout: "modern",
    defaultHttpClient: {
      targetKey: "js",
      clientKey: "fetch",
    },
  })
);

// 404 handler
app.notFound((c) => {
  logger.warn(`404 - Route not found: ${c.req.method} ${c.req.path}`);
  return c.json(
    {
      status: 404,
      message: "Route not found",
      error_source: "client",
    },
    404
  );
});

// Start server
const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch.bind(app),
});

logger.info(`🚀 Server running on http://localhost:${env.PORT}`);
logger.info(
  `📚 API Documentation available at http://localhost:${env.PORT}/docs`
);
logger.info(`🔧 Environment: ${env.NODE_ENV}`);

export default app;
