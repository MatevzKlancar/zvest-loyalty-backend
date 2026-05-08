import { env } from "../../config/env";
import { generateWithGemini } from "./gemini";

export interface AIReportRecommendation {
  title: string;
  action: string;
  expected_impact: string;
  evidence: string;
}

export interface AIReportOutput {
  summary: string;
  highlights: string[];
  recommendations: AIReportRecommendation[];
}

export interface LLMRequest {
  systemPrompt: string;
  userMessage: string;
}

export async function generateAIReport(
  req: LLMRequest
): Promise<{ output: AIReportOutput; model: string }> {
  switch (env.LLM_PROVIDER) {
    case "gemini":
      return generateWithGemini(req);
    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${env.LLM_PROVIDER}`);
  }
}
