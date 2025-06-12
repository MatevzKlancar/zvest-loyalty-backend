import { Context, Next } from "hono";
import { supabase } from "../config/database";
import { logger } from "../config/logger";

export interface AuthContext {
  Variables: {
    posProvider: {
      id: string;
      name: string;
      api_key: string;
    };
  };
}

export async function authenticatePOSProvider(
  c: Context<AuthContext>,
  next: Next
) {
  const apiKey = c.req.header("x-api-key");

  if (!apiKey) {
    logger.warn("Missing API key in request");
    return c.json(
      {
        status: 500,
        message: "API key is required",
        error_source: "client",
      },
      401
    );
  }

  try {
    const { data: provider, error } = await supabase
      .from("pos_providers")
      .select("id, name, api_key")
      .eq("api_key", apiKey)
      .single();

    if (error || !provider) {
      logger.warn(`Invalid API key attempt: ${apiKey}`);
      return c.json(
        {
          status: 500,
          message: "Invalid API key",
          error_source: "client",
        },
        401
      );
    }

    c.set("posProvider", provider);
    logger.info(`Authenticated POS provider: ${provider.name}`);

    await next();
  } catch (error) {
    logger.error("Database error during authentication:", error);
    return c.json(
      {
        status: 500,
        message: "Internal server error",
        error_source: "server",
      },
      500
    );
  }
}
