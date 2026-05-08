import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import type { AIReportOutput, LLMRequest } from "./index";

const SCHEMA_SAFE_MODELS = new Set(["gemini-2.0-flash", "gemini-2.5-flash"]);

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    highlights: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    recommendations: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          action: { type: SchemaType.STRING },
          expected_impact: { type: SchemaType.STRING },
          evidence: { type: SchemaType.STRING },
        },
        required: ["title", "action", "expected_impact", "evidence"],
      },
    },
  },
  required: ["summary", "highlights", "recommendations"],
};

export async function generateWithGemini(
  req: LLMRequest
): Promise<{ output: AIReportOutput; model: string }> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const useSchema = SCHEMA_SAFE_MODELS.has(env.GEMINI_MODEL);

  const generationConfig: any = {
    responseMimeType: "application/json",
    temperature: 0.4,
  };
  if (useSchema) {
    generationConfig.responseSchema = responseSchema;
  }

  const model = client.getGenerativeModel({
    model: env.GEMINI_MODEL,
    systemInstruction: req.systemPrompt,
    generationConfig,
  });

  let text: string;
  try {
    const result = await model.generateContent(req.userMessage);
    text = result.response.text();
  } catch (err: any) {
    logger.error("Gemini API call failed", {
      model: env.GEMINI_MODEL,
      message: err?.message,
      status: err?.status,
      statusText: err?.statusText,
    });
    throw new Error(`Gemini API error: ${err?.message ?? "unknown"}`);
  }

  let parsed: AIReportOutput;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      logger.error("Gemini returned non-JSON output", { textPreview: text.slice(0, 500) });
      throw new Error("Gemini returned malformed JSON");
    }
  }

  return { output: parsed, model: env.GEMINI_MODEL };
}
