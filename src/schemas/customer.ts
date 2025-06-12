import { z } from "@hono/zod-openapi";

export const scanQRSchema = z.object({
  shop_id: z.string().uuid().openapi({
    description: "ID of the shop",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
  invoice_id: z.string().min(1).openapi({
    description: "Invoice ID printed on the receipt",
    example: "INV-2024-001",
  }),
  customer_id: z.string().uuid().optional().openapi({
    description: "Optional customer ID for tracking",
    example: "123e4567-e89b-12d3-a456-426614174002",
  }),
});

export const transactionDetailsSchema = z.object({
  shop_id: z.string().uuid().openapi({
    description: "ID of the shop",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
  invoice_id: z.string().min(1).openapi({
    description: "Invoice ID printed on the receipt",
    example: "INV-2024-001",
  }),
});
