import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";
import { transactionResponseSchema } from "./schemas";

export const transactionsController = new OpenAPIHono<UnifiedAuthContext>();

// Get recent transactions
const getTransactionsRoute = createRoute({
  method: "get",
  path: "/transactions",
  summary: "Get recent transactions",
  description: "Get recent transactions for the shop",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      limit: z.string().optional(),
      offset: z.string().optional(),
      status: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Transactions retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.array(transactionResponseSchema),
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

transactionsController.openapi(getTransactionsRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { limit = "50", offset = "0", status } = c.req.valid("query");

    let query = supabase
      .from("transactions")
      .select(
        `
        id,
        pos_invoice_id,
        total_amount,
        tax_amount,
        status,
        loyalty_points_awarded,
        created_at,
        app_users (
          first_name,
          last_name,
          phone_number
        )
      `,
        { count: "exact" }
      )
      .eq("shop_id", shop.id);

    if (status) {
      query = query.eq("status", status);
    }

    const {
      data: transactions,
      error,
      count,
    } = await query
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      logger.error("Failed to fetch transactions:", error);
      return c.json(standardResponse(500, "Failed to fetch transactions"), 500);
    }

    return c.json({
      success: true,
      message: "Transactions retrieved successfully",
      data: transactions,
      meta: {
        total: count || 0,
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    logger.error("Error fetching transactions:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});