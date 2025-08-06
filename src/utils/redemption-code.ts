import { supabase } from "../config/database";
import { logger } from "../config/logger";

/**
 * Generates a McDonald's style redemption code
 * Examples: "N21-555", "K45-123", "A07-999"
 * Format: [Letter][2-digits]-[3-digits]
 */
export function generateSecureRedemptionCode(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const letter = letters[Math.floor(Math.random() * letters.length)];
  const firstPart = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0");
  const secondPart = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${letter}${firstPart}-${secondPart}`;
}

/**
 * Generates a unique redemption code with collision detection
 * Retries up to maxAttempts times if collisions occur
 */
export async function generateUniqueRedemptionCode(
  maxAttempts: number = 10
): Promise<
  { success: true; code: string } | { success: false; error: string }
> {
  let attempts = 0;

  while (attempts < maxAttempts) {
    const code = generateSecureRedemptionCode();

    try {
      // Check if code already exists
      const { data: existingRedemption, error: checkError } = await supabase
        .from("coupon_redemptions")
        .select("id")
        .eq("id", code)
        .single();

      if (checkError && checkError.code === "PGRST116") {
        // No existing record found - code is unique
        updateCodeGenerationStats(attempts > 0); // Track if we had collisions
        logger.info(
          `Generated unique redemption code: ${code} (attempt ${attempts + 1})`
        );
        return { success: true, code };
      } else if (checkError) {
        logger.error("Database error checking code uniqueness:", checkError);
        return {
          success: false,
          error: `Database error: ${checkError.message}`,
        };
      } else {
        // Code exists, try again
        attempts++;
        logger.warn(
          `Collision detected for code: ${code}, attempt ${attempts}/${maxAttempts}`
        );
      }
    } catch (error) {
      logger.error("Unexpected error generating redemption code:", error);
      return {
        success: false,
        error: "Unexpected error during code generation",
      };
    }
  }

  updateCodeGenerationStats(true); // Failed generation = collision issue
  logger.error(
    `Failed to generate unique redemption code after ${maxAttempts} attempts`
  );
  return {
    success: false,
    error: `Failed to generate unique code after ${maxAttempts} attempts`,
  };
}

/**
 * Validates redemption code format (McDonald's style: Letter + 2 digits + dash + 3 digits)
 * Examples: "N21-555", "K45-123", "A07-999"
 */
export function isValidRedemptionCodeFormat(code: string): boolean {
  return /^[A-Z]\d{2}-\d{3}$/.test(code);
}

/**
 * Statistics for monitoring collision rates
 */
export interface CodeGenerationStats {
  totalAttempts: number;
  collisions: number;
  collisionRate: number;
}

// Simple in-memory stats (could be moved to Redis/database for production)
let generationStats: CodeGenerationStats = {
  totalAttempts: 0,
  collisions: 0,
  collisionRate: 0,
};

export function getCodeGenerationStats(): CodeGenerationStats {
  return { ...generationStats };
}

export function updateCodeGenerationStats(hadCollision: boolean): void {
  generationStats.totalAttempts++;
  if (hadCollision) {
    generationStats.collisions++;
  }
  generationStats.collisionRate =
    generationStats.collisions / generationStats.totalAttempts;
}
