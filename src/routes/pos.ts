import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { authenticatePOSProvider, type AuthContext } from "../middleware/auth";
import { POSService } from "../services/posService";
import { standardResponse } from "../middleware/error";
import {
  validateCouponSchema,
  syncShopSchema,
  shopCouponsParamsSchema,
  updateArticlesSchema,
  articleParamsSchema,
  createTransactionSchema,
  standardResponseSchema,
  couponResponseSchema,
  shopResponseSchema,
} from "../schemas/pos";

const pos = new OpenAPIHono<AuthContext>();
const posService = new POSService();

// Apply authentication middleware to all routes
pos.use("*", authenticatePOSProvider);

// Validate coupon route
const validateCouponRoute = createRoute({
  method: "post",
  path: "/coupons/validate",
  summary: "Validate and use a coupon",
  description: "Validates a coupon for a specific shop and marks it as used",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: validateCouponSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Coupon validated successfully",
      content: {
        "application/json": {
          schema: standardResponseSchema.extend({
            data: couponResponseSchema.optional(),
          }),
        },
      },
    },
    400: {
      description: "Invalid request or coupon",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
  },
});

pos.openapi(validateCouponRoute, async (c) => {
  const { shop_id, coupon_id } = c.req.valid("json");
  const posProvider = c.get("posProvider");

  const result = await posService.validateCoupon(
    shop_id,
    coupon_id,
    posProvider.id
  );

  if (result.success) {
    return c.json(standardResponse(200, result.message, result.data));
  } else {
    const statusCode = result.errorSource === "client" ? 400 : 500;
    return c.json(
      standardResponse(
        statusCode,
        result.message,
        undefined,
        result.errorSource
      ),
      statusCode
    );
  }
});

// Get shops route
const getShopsRoute = createRoute({
  method: "get",
  path: "/shops",
  summary: "Get all active shops for POS provider",
  description:
    "Retrieves all active shops associated with the authenticated POS provider",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  responses: {
    200: {
      description: "Active shops retrieved successfully",
      content: {
        "application/json": {
          schema: standardResponseSchema.extend({
            data: shopResponseSchema.array().optional(),
          }),
        },
      },
    },
  },
});

pos.openapi(getShopsRoute, async (c) => {
  const posProvider = c.get("posProvider");

  const result = await posService.getShopsForProvider(posProvider.id);

  if (result.success) {
    return c.json(standardResponse(200, result.message, result.data));
  } else {
    return c.json(
      standardResponse(500, result.message, undefined, result.errorSource),
      500
    );
  }
});

// Sync shop route (replaces create shop)
const syncShopRoute = createRoute({
  method: "post",
  path: "/shops/sync",
  summary: "Sync shop with POS system",
  description:
    "Links and syncs an existing Zvest shop with POS system data. The shop must be pre-registered by Zvest admin.",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: syncShopSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Shop synced successfully",
      content: {
        "application/json": {
          schema: standardResponseSchema.extend({
            data: shopResponseSchema.optional(),
          }),
        },
      },
    },
    400: {
      description: "Shop not found, inactive, or access denied",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
  },
});

pos.openapi(syncShopRoute, async (c) => {
  const syncData = c.req.valid("json");
  const posProvider = c.get("posProvider");

  const result = await posService.syncShop(syncData, posProvider.id);

  if (result.success) {
    return c.json(standardResponse(200, result.message, result.data));
  } else {
    const statusCode = result.errorSource === "client" ? 400 : 500;
    return c.json(
      standardResponse(
        statusCode,
        result.message,
        undefined,
        result.errorSource
      ),
      statusCode
    );
  }
});

// Get shop coupons route
const getShopCouponsRoute = createRoute({
  method: "get",
  path: "/shops/{id}/coupons",
  summary: "Get active coupons for shop",
  description: "Retrieves all active coupons for a specific shop",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: shopCouponsParamsSchema,
  },
  responses: {
    200: {
      description: "Coupons retrieved successfully",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
    400: {
      description: "Shop not found or inactive",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
  },
});

pos.openapi(getShopCouponsRoute, async (c) => {
  const { id } = c.req.valid("param");
  const posProvider = c.get("posProvider");

  const result = await posService.getActiveCouponsForShop(id, posProvider.id);

  if (result.success) {
    return c.json(standardResponse(200, result.message, result.data));
  } else {
    const statusCode = result.errorSource === "client" ? 400 : 500;
    return c.json(
      standardResponse(
        statusCode,
        result.message,
        undefined,
        result.errorSource
      ),
      statusCode
    );
  }
});

// Update shop articles route
const updateShopArticlesRoute = createRoute({
  method: "post",
  path: "/shops/{id}/articles",
  summary: "Update shop articles/menu",
  description: "Updates the complete article/menu structure for a shop",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: articleParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateArticlesSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Articles updated successfully",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
    400: {
      description: "Shop not found, inactive, or invalid data",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
  },
});

pos.openapi(updateShopArticlesRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { articles } = c.req.valid("json");
  const posProvider = c.get("posProvider");

  const result = await posService.updateShopArticles(
    id,
    articles,
    posProvider.id
  );

  if (result.success) {
    return c.json(standardResponse(200, result.message));
  } else {
    const statusCode = result.errorSource === "client" ? 400 : 500;
    return c.json(
      standardResponse(
        statusCode,
        result.message,
        undefined,
        result.errorSource
      ),
      statusCode
    );
  }
});

// Create transaction route
const createTransactionRoute = createRoute({
  method: "post",
  path: "/transactions",
  summary: "Save a new transaction",
  description:
    "Saves a transaction from the POS system for later loyalty processing",
  tags: ["POS Integration"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createTransactionSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Transaction created successfully",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
    400: {
      description: "Transaction already exists, shop inactive, or invalid data",
      content: {
        "application/json": {
          schema: standardResponseSchema,
        },
      },
    },
  },
});

pos.openapi(createTransactionRoute, async (c) => {
  const transactionData = c.req.valid("json");
  const posProvider = c.get("posProvider");

  const result = await posService.createTransaction(
    transactionData,
    posProvider.id
  );

  if (result.success) {
    return c.json(standardResponse(200, result.message, result.data));
  } else {
    const statusCode = result.errorSource === "client" ? 400 : 500;
    return c.json(
      standardResponse(
        statusCode,
        result.message,
        undefined,
        result.errorSource
      ),
      statusCode
    );
  }
});

export { pos };
