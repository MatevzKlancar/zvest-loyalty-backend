import { Context, Next } from "hono";
import { logger } from "../config/logger";
import { getPosProvidersFromEnv } from "../config/env";
import { supabase } from "../config/database";

export interface AuthContext {
  Variables: {
    posProvider: {
      id: string;
      name: string;
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
        status: 401,
        message: "API key is required",
        error_source: "client",
      },
      401
    );
  }

  try {
    // Get valid API keys from environment
    const validProviders = getPosProvidersFromEnv();
    const provider = validProviders.find((p) => p.apiKey === apiKey);

    if (!provider) {
      logger.warn(`Invalid API key attempt: ${apiKey.substring(0, 10)}...`);
      return c.json(
        {
          status: 401,
          message: "Invalid API key",
          error_source: "client",
        },
        401
      );
    }

    // Look up the actual database POS provider by name
    const { data: dbProvider, error } = await supabase
      .from("pos_providers")
      .select("id, name")
      .eq("name", provider.name)
      .eq("is_active", true)
      .single();

    if (error || !dbProvider) {
      logger.error(`Database POS provider not found: ${provider.name}`, error);
      return c.json(
        {
          status: 500,
          message: "POS provider configuration error",
          error_source: "server",
        },
        500
      );
    }

    // Set the database provider object
    c.set("posProvider", {
      id: dbProvider.id,
      name: dbProvider.name,
    });

    logger.info(`Authenticated POS provider: ${provider.name}`);
    await next();
  } catch (error) {
    logger.error("Error during authentication:", error);
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
