import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // POS Provider API Keys (comma-separated format: name:api_key)
  // Example: "Provider1:api_key_1,Provider2:api_key_2"
  POS_PROVIDERS: z.string().default(""),

  // Global push delivery kill switch. When false, the service builds messages,
  // resolves recipients, writes push_notifications rows with status='dry_run',
  // and skips the Expo HTTP call. Flip to true to actually deliver.
  PUSH_NOTIFICATIONS_DELIVERY_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
});

export const env = envSchema.parse(process.env);

// Parse POS providers from environment
export function getPosProvidersFromEnv(): Array<{
  name: string;
  apiKey: string;
  description?: string;
}> {
  const providers: Array<{
    name: string;
    apiKey: string;
    description?: string;
  }> = [];

  // Parse providers from POS_PROVIDERS env var
  // Format: "Provider1:api_key_1,Provider2:api_key_2"
  if (env.POS_PROVIDERS) {
    const providerEntries = env.POS_PROVIDERS.split(",");
    for (const entry of providerEntries) {
      const [name, apiKey] = entry.split(":");
      if (name && apiKey) {
        providers.push({
          name: name.trim(),
          apiKey: apiKey.trim(),
          description: `${name.trim()} POS Provider`,
        });
      }
    }
  }

  return providers;
}
