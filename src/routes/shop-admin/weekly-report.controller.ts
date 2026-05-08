import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { supabase } from "../../config/database";
import { logger } from "../../config/logger";
import { standardResponse } from "../../middleware/error";
import { UnifiedAuthContext } from "../../middleware/unified-auth";
import { buildWeeklyStatsPacket } from "../../services/weekly-report/aggregator";
import { buildReportPrompt } from "../../services/weekly-report/prompt";
import { generateAIReport } from "../../services/llm";

export const weeklyReportController = new OpenAPIHono<UnifiedAuthContext>();

const recommendationSchema = z.object({
  title: z.string(),
  action: z.string(),
  expected_impact: z.string(),
  evidence: z.string(),
});

const aiReportSchema = z.object({
  summary: z.string(),
  highlights: z.array(z.string()),
  recommendations: z.array(recommendationSchema),
});

const weeklyReportRoute = createRoute({
  method: "get",
  path: "/weekly-report",
  summary: "Get AI-generated weekly report",
  description:
    "Aggregates the last 7 days of transactions, coupons, customers, and products for the shop, then asks an LLM (Gemini) to produce a narrative summary with actionable recommendations. Pass weekOffset=1 to get last week.",
  tags: ["Shop Management"],
  security: [{ BearerAuth: [] }],
  request: {
    query: z.object({
      weekOffset: z
        .string()
        .optional()
        .describe("0 = current 7 days (default), 1 = previous 7 days, etc."),
    }),
  },
  responses: {
    200: {
      description: "Weekly report generated",
      content: {
        "application/json": {
          schema: z.object({
            status: z.number(),
            message: z.string(),
            data: z.object({
              stats: z.any(),
              ai: aiReportSchema.nullable(),
              ai_error: z.string().optional(),
              model: z.string().nullable(),
              generated_at: z.string(),
            }),
          }),
        },
      },
    },
  },
});

weeklyReportController.openapi(weeklyReportRoute, async (c) => {
  try {
    const shop = c.get("shop");
    if (!shop?.id) {
      return c.json(standardResponse(403, "No shop in context"), 403);
    }

    const { weekOffset } = c.req.valid("query");
    const offset = weekOffset ? Math.max(0, parseInt(weekOffset, 10) || 0) : 0;

    const { data: shopRow, error: shopErr } = await supabase
      .from("shops")
      .select("id, name, loyalty_type")
      .eq("id", shop.id)
      .single();

    if (shopErr || !shopRow) {
      logger.error("Weekly report: failed to load shop", shopErr);
      return c.json(standardResponse(500, "Failed to load shop"), 500);
    }

    const stats = await buildWeeklyStatsPacket({
      shopId: shopRow.id,
      shopName: shopRow.name,
      loyaltyType: shopRow.loyalty_type,
      weekOffset: offset,
    });

    let ai = null as Awaited<ReturnType<typeof generateAIReport>>["output"] | null;
    let aiError: string | undefined;
    let model: string | null = null;

    try {
      const prompt = buildReportPrompt(stats);
      const result = await generateAIReport(prompt);
      ai = result.output;
      model = result.model;
    } catch (err: any) {
      aiError = err?.message ?? "LLM generation failed";
      logger.error("Weekly report: LLM generation failed", { error: aiError });
    }

    return c.json(
      standardResponse(200, "Weekly report generated", {
        stats,
        ai,
        ai_error: aiError,
        model,
        generated_at: new Date().toISOString(),
      })
    );
  } catch (error) {
    logger.error("Error generating weekly report:", error);
    return c.json(standardResponse(500, "Internal server error"), 500);
  }
});
