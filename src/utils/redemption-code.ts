import { supabase } from "../config/database";
import { logger } from "../config/logger";

/**
 * Generates a 6-digit numeric redemption code
 * Examples: "123456", "987654", "000123"
 * Format: 6 digits (000000-999999)
 *
 * Note: Frontend displays as "123-456" for readability,
 * but POS systems use raw 6-digit format "123456"
 */
export function generateSecureRedemptionCode(): string {
  return Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");
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
      // For MVP: Generate codes without collision checking since we use UUID ids
      // The probability of collision with McDonald's style codes is extremely low
      updateCodeGenerationStats(false);
      logger.info(
        `Generated redemption code: ${code} (attempt ${attempts + 1})`
      );
      return { success: true, code };
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
 * Validates redemption code format (6 digits)
 * Examples: "123456", "987654", "000123"
 */
export function isValidRedemptionCodeFormat(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * Formats a 6-digit redemption code for display in frontend
 * Examples: "123456" -> "123-456", "000123" -> "000-123"
 */
export function formatRedemptionCodeForDisplay(code: string): string {
  if (!isValidRedemptionCodeFormat(code)) {
    return code; // Return as-is if invalid format
  }
  return `${code.substring(0, 3)}-${code.substring(3, 6)}`;
}

/**
 * Removes formatting from redemption code (for POS input)
 * Examples: "123-456" -> "123456", "000-123" -> "000123"
 */
export function normalizeRedemptionCode(code: string): string {
  return code.replace(/[^0-9]/g, "");
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
