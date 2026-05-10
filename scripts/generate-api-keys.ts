#!/usr/bin/env bun
/**
 * API Key Generation Script for POS Providers
 *
 * Generates secure API keys for environment variable storage only.
 * No database storage - keys are validated from environment.
 *
 * Usage:
 *   bun run scripts/generate-api-keys.ts
 *   bun run scripts/generate-api-keys.ts --provider "Company Name"
 *   bun run scripts/generate-api-keys.ts --count 5
 */

import crypto from "crypto";

interface APIKeyInfo {
  provider: string;
  apiKey: string;
  created: string;
}

function generateSecureAPIKey(provider: string): string {
  const timestamp = Date.now().toString();
  const randomBytes = crypto.randomBytes(16).toString("hex");

  // Format: pos-{provider-slug}-{timestamp-short}-{random}
  const providerSlug = provider
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const timestampShort = timestamp.slice(-8);
  const randomShort = randomBytes.slice(0, 12);

  return `pos-${providerSlug}-${timestampShort}-${randomShort}`;
}

function generateEnvironmentFormat(apiKeys: APIKeyInfo[]): string {
  const providerPairs = apiKeys.map((key) => `${key.provider}:${key.apiKey}`);
  return `POS_PROVIDERS="${providerPairs.join(",")}"`;
}

function main() {
  const args = process.argv.slice(2);
  let providers: string[] = [];
  let count = 1;

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--provider" && i + 1 < args.length) {
      providers.push(args[i + 1]);
      i++;
    } else if (args[i] === "--count" && i + 1 < args.length) {
      count = parseInt(args[i + 1]);
      i++;
    }
  }

  // Default providers if none specified
  if (providers.length === 0) {
    providers = [
      "Elektronek POS",
      "Retail Pro",
      "Square POS",
      "TouchBistro",
      "Toast POS",
    ].slice(0, count);
  }

  console.log("🔑 Generating API Keys for POS Providers\n");

  const apiKeys: APIKeyInfo[] = providers.map((provider) => ({
    provider,
    apiKey: generateSecureAPIKey(provider),
    created: new Date().toISOString(),
  }));

  // Display generated keys
  console.log("Generated API Keys:");
  console.log("=".repeat(80));
  apiKeys.forEach((key) => {
    console.log(`Provider: ${key.provider}`);
    console.log(`API Key:  ${key.apiKey}`);
    console.log(`Created:  ${key.created}`);
    console.log("-".repeat(80));
  });

  console.log("\n📋 Environment Variable Format:");
  console.log("=".repeat(80));
  console.log(generateEnvironmentFormat(apiKeys));

  console.log("\n🔐 API Key Security Notes:");
  console.log("=".repeat(80));
  console.log("✅ API keys are stored ONLY in environment variables");
  console.log("✅ No database storage of API keys");
  console.log("✅ Keys are validated directly from environment");
  console.log("✅ Rotate keys by updating environment variables");

  console.log("\n🚀 Next Steps:");
  console.log("1. Copy the environment variable above to your .env file");
  console.log("2. Restart your server");
  console.log(
    '3. Test with: curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/pos/shops'
  );
  console.log("4. For production: set environment variables on your server");
}

if (import.meta.main) {
  main();
}
