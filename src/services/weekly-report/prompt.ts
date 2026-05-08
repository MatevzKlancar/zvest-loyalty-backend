import type { WeeklyStatsPacket } from "./aggregator";
import type { LLMRequest } from "../llm";

const SYSTEM_PROMPT = `You are a retail analyst writing a concise, actionable weekly report for an independent shop owner using the Zvest loyalty platform.

Rules:
- Be specific. Cite real numbers from the stats packet (revenue totals, weekday names, hour ranges, customer/coupon names).
- Use the shop's currency (default EUR, format like "€123.45").
- Recommend concrete actions: pricing changes, coupon adjustments, timing-based promotions, customer re-engagement.
- Each recommendation must reference evidence from the data — never invent numbers.
- Keep the summary to 2-3 sentences. 3-5 highlights. 3-5 recommendations.
- Skip metrics that are zero or empty rather than padding with filler.
- If \`revenue.likely_closed_weekdays\` is non-empty, treat those weekdays as days the shop is closed: do NOT recommend actions for those days, do NOT call them out as "missed opportunity" or "worst day", and do NOT include them in any peak/dead-day analysis.
- Tone: practical, direct, like a consultant who respects the owner's time.`;

export function buildReportPrompt(stats: WeeklyStatsPacket): LLMRequest {
  const userMessage = `Generate a weekly report for "${stats.shop.name}".

Period: ${stats.period.current.start.slice(0, 10)} to ${stats.period.current.end.slice(0, 10)} (compared to prior 7 days).
Currency: ${stats.shop.currency}
Loyalty program: ${stats.shop.loyalty_type ?? "none"}

Stats packet:
${JSON.stringify(stats, null, 2)}

Return JSON matching this shape:
{
  "summary": "2-3 sentence narrative of the week",
  "highlights": ["bullet 1", "bullet 2", ...],
  "recommendations": [
    {
      "title": "short imperative title",
      "action": "what the owner should do this week",
      "expected_impact": "expected outcome in plain language",
      "evidence": "the specific data point(s) backing this — cite numbers"
    }
  ]
}`;

  return { systemPrompt: SYSTEM_PROMPT, userMessage };
}
