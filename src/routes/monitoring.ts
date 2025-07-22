import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { getCodeGenerationStats } from "../utils/redemption-code";
import { standardResponse } from "../middleware/error";

const monitoring = new OpenAPIHono();

// Monitoring endpoint for redemption code generation stats
const getRedemptionStatsRoute = createRoute({
  method: "get",
  path: "/redemption-codes/stats",
  summary: "Get redemption code generation statistics",
  description:
    "Returns statistics about collision rates and generation performance",
  tags: ["Monitoring"],
  responses: {
    200: {
      description: "Redemption code statistics retrieved successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
            data: z.object({
              totalAttempts: z.number(),
              collisions: z.number(),
              collisionRate: z.number(),
              recommendedAction: z.string(),
            }),
          }),
        },
      },
    },
  },
});

monitoring.openapi(getRedemptionStatsRoute, async (c) => {
  try {
    const stats = getCodeGenerationStats();

    // Add recommendation based on collision rate
    let recommendedAction = "System operating normally";
    if (stats.collisionRate > 0.1) {
      recommendedAction =
        "High collision rate detected - consider expanding code space or implementing cleanup";
    } else if (stats.collisionRate > 0.01) {
      recommendedAction = "Moderate collision rate - monitor closely";
    }

    const response = {
      ...stats,
      recommendedAction,
    };

    return c.json(
      standardResponse(200, "Redemption code statistics retrieved", response)
    );
  } catch (error) {
    return c.json(standardResponse(500, "Failed to retrieve statistics"), 500);
  }
});

export default monitoring;
