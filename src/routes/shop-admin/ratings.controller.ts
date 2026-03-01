import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";

export const ratingsController = new OpenAPIHono<UnifiedAuthContext>();

const ratingItemSchema = z.object({
  id: z.string().uuid(),
  rating: z.number(),
  comment: z.string().nullable(),
  created_at: z.string(),
  transaction_id: z.string().uuid(),
});

const ratingsStatsSchema = z.object({
  average_rating: z.number().nullable(),
  total_ratings: z.number(),
});

const getRatingsRoute = createRoute({
  method: "get",
  path: "/ratings",
  summary: "View service ratings",
  description: "View service ratings submitted by customers. Returns paginated list with aggregate stats.",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      page: z.string().optional().default("1"),
      limit: z.string().optional().default("20"),
    }),
  },
  responses: {
    200: {
      description: "Ratings retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              ratings: z.array(ratingItemSchema),
              stats: ratingsStatsSchema,
              pagination: z.object({
                page: z.number(),
                limit: z.number(),
                total: z.number(),
              }),
            }),
          }),
        },
      },
    },
  },
});

ratingsController.openapi(getRatingsRoute, async (c) => {
  try {
    const shop = c.get("shop");
    const { page: pageStr, limit: limitStr } = c.req.valid("query");
    const page = Math.max(1, parseInt(pageStr || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitStr || "20", 10) || 20));
    const offset = (page - 1) * limit;

    // Get total count
    const { count, error: countError } = await supabase
      .from("service_ratings")
      .select("*", { count: "exact", head: true })
      .eq("shop_id", shop.id);

    if (countError) {
      logger.error("Failed to count ratings:", countError);
      return c.json(standardResponse(500, "Failed to fetch ratings"), 500);
    }

    // Get paginated ratings (newest first, no customer PII)
    const { data: ratings, error: ratingsError } = await supabase
      .from("service_ratings")
      .select("id, rating, comment, created_at, transaction_id")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (ratingsError) {
      logger.error("Failed to fetch ratings:", ratingsError);
      return c.json(standardResponse(500, "Failed to fetch ratings"), 500);
    }

    // Get aggregate stats
    const { data: statsData, error: statsError } = await supabase
      .rpc("get_service_rating_stats", { p_shop_id: shop.id });

    let stats = { average_rating: null as number | null, total_ratings: count || 0 };

    if (statsError) {
      logger.warn("Failed to fetch rating stats via RPC:", statsError);
    }

    if (!statsError && statsData && statsData.length > 0) {
      stats.average_rating = statsData[0].average_rating
        ? parseFloat(Number(statsData[0].average_rating).toFixed(1))
        : null;
    }

    return c.json(
      standardResponse(200, "Ratings retrieved successfully", {
        ratings: ratings || [],
        stats,
        pagination: { page, limit, total: count || 0 },
      })
    );
  } catch (error) {
    logger.error("Error fetching ratings:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});
