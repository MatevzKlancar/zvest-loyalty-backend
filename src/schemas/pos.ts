import { z } from "@hono/zod-openapi";

// Common schemas
export const apiKeySchema = z.object({
  "x-api-key": z.string().min(1, "API key is required").openapi({
    description: "API key for POS provider authentication",
    example: "test-api-key-elektronček-pos-2024",
  }),
});

// Standard response schemas
export const standardResponseSchema = z.object({
  status: z.number().openapi({ description: "HTTP status code", example: 200 }),
  message: z
    .string()
    .openapi({ description: "Response message", example: "Success" }),
  data: z
    .any()
    .optional()
    .openapi({ description: "Response data (when applicable)" }),
  error_source: z.enum(["client", "server", "pos"]).optional().openapi({
    description: "Source of error (when status >= 400)",
  }),
});

// Coupon validation
export const validateCouponSchema = z.object({
  shop_id: z.string().uuid().openapi({
    description: "ID of the shop",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
  coupon_id: z.string().uuid().openapi({
    description: "ID of the coupon to validate",
    example: "123e4567-e89b-12d3-a456-426614174001",
  }),
});

export const couponResponseSchema = z.object({
  type: z.enum(["percentage", "fixed", "free_item"]).openapi({
    description: "Type of coupon discount",
  }),
  value: z.number().openapi({
    description: "Discount value (percentage or fixed amount)",
    example: 10.0,
  }),
  description: z.string().nullable().openapi({
    description: "Coupon description",
    example: "10% discount for new customers",
  }),
});

// Shop sync schemas (replaces shop creation)
export const syncShopSchema = z.object({
  shop_uuid: z.string().uuid().openapi({
    description: "Zvest shop UUID (provided during onboarding)",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
  pos_shop_id: z.string().openapi({
    description: "POS system's internal shop ID",
    example: "shop-001",
  }),
  pos_data: z
    .object({
      name: z.string().optional().openapi({
        description: "Shop name from POS system",
        example: "Coffee Shop Downtown",
      }),
      location: z.string().optional().openapi({
        description: "Shop location/address",
        example: "Main Street 123, City",
      }),
      contact: z.string().optional().openapi({
        description: "Contact information",
        example: "+1-555-0123",
      }),
      operating_hours: z.object({}).optional().openapi({
        description: "Operating hours from POS",
      }),
      additional_data: z.object({}).optional().openapi({
        description: "Any additional POS-specific data",
      }),
    })
    .openapi({
      description: "POS-specific data to sync with Zvest system",
    }),
});

export const shopResponseSchema = z.object({
  id: z.string().uuid().openapi({ description: "Internal shop UUID" }),
  pos_shop_id: z
    .string()
    .nullable()
    .openapi({ description: "POS system shop ID" }),
  name: z.string().openapi({ description: "Shop name" }),
  description: z
    .string()
    .nullable()
    .openapi({ description: "Shop description" }),
  type: z.string().nullable().openapi({ description: "Shop type" }),
  status: z
    .enum(["pending", "active", "suspended"])
    .openapi({ description: "Shop status" }),
  pos_synced_at: z
    .string()
    .nullable()
    .openapi({ description: "Last POS sync timestamp" }),
  created_at: z.string().openapi({ description: "Creation timestamp" }),
  updated_at: z.string().openapi({ description: "Last update timestamp" }),
});

export const shopCouponsParamsSchema = z.object({
  id: z.string().uuid().openapi({
    description: "Shop UUID",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
});

// Articles schema
export const articleItemSchema = z.object({
  id: z.string().openapi({
    description: "POS article ID",
    example: "art-001",
  }),
  name: z.string().min(1).openapi({
    description: "Article name",
    example: "Espresso",
  }),
  price: z.number().positive().openapi({
    description: "Article price",
    example: 2.5,
  }),
  description: z.string().optional().openapi({
    description: "Article description",
    example: "Strong Italian coffee",
  }),
  type: z.string().optional().openapi({
    description: "Article type",
    example: "beverage",
  }),
  tax_type: z.string().optional().openapi({
    description: "Tax type",
    example: "standard",
  }),
});

export const updateArticlesSchema = z.object({
  articles: z.array(articleItemSchema).openapi({
    description: "Array of articles to update for the shop",
  }),
});

export const articleParamsSchema = z.object({
  id: z.string().uuid().openapi({
    description: "Shop UUID",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
});

// Transaction schema
export const transactionItemSchema = z.object({
  article_id: z.string().openapi({
    description: "POS article ID",
    example: "art-001",
  }),
  name: z.string().openapi({
    description: "Article name",
    example: "Espresso",
  }),
  quantity: z.number().positive().openapi({
    description: "Quantity purchased",
    example: 2,
  }),
  price: z.number().positive().openapi({
    description: "Unit price",
    example: 2.5,
  }),
  total: z.number().positive().openapi({
    description: "Line total (quantity * price)",
    example: 5.0,
  }),
});

export const createTransactionSchema = z.object({
  shop_id: z.string().uuid().openapi({
    description: "Shop UUID",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
  pos_invoice_id: z.string().min(1).openapi({
    description: "POS invoice ID (printed on receipt)",
    example: "INV-2024-001",
  }),
  total_amount: z.number().positive().openapi({
    description: "Total transaction amount",
    example: 5.7,
  }),
  items: z.array(transactionItemSchema).openapi({
    description: "Array of purchased items",
  }),
});
