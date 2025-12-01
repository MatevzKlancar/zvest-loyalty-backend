/**
 * Feature tagging system for shop capabilities
 *
 * Features are stored as a JSONB array in shops.feature_tags
 * This allows flexible feature gating for both frontend and backend
 */

/**
 * Available feature tags
 * Add new features here as they're implemented
 */
export const FEATURE_TAGS = {
  EXTERNAL_QR_CODES: 'external-qr-codes',
  ADVANCED_ANALYTICS: 'advanced-analytics',
  MULTI_LOCATION: 'multi-location',
  CUSTOM_BRANDING: 'custom-branding',
  API_ACCESS: 'api-access',
} as const;

export type FeatureTag = typeof FEATURE_TAGS[keyof typeof FEATURE_TAGS];

/**
 * Check if a shop has a specific feature enabled
 *
 * @param shop - Shop object with feature_tags field
 * @param feature - Feature tag to check (use FEATURE_TAGS constants)
 * @returns true if shop has the feature enabled
 *
 * @example
 * ```typescript
 * if (hasFeature(shop, FEATURE_TAGS.EXTERNAL_QR_CODES)) {
 *   // Show QR code import UI
 * }
 * ```
 */
export function hasFeature(
  shop: { feature_tags?: any } | null | undefined,
  feature: string
): boolean {
  if (!shop || !shop.feature_tags) {
    return false;
  }

  // Handle both PostgreSQL JSONB and JavaScript array types
  const tags = Array.isArray(shop.feature_tags)
    ? shop.feature_tags
    : shop.feature_tags;

  return tags.includes(feature);
}

/**
 * Check if a shop has all of the specified features
 *
 * @param shop - Shop object with feature_tags field
 * @param features - Array of feature tags to check
 * @returns true if shop has ALL specified features
 *
 * @example
 * ```typescript
 * if (hasAllFeatures(shop, [FEATURE_TAGS.EXTERNAL_QR_CODES, FEATURE_TAGS.API_ACCESS])) {
 *   // Shop has both features
 * }
 * ```
 */
export function hasAllFeatures(
  shop: { feature_tags?: any } | null | undefined,
  features: string[]
): boolean {
  return features.every(feature => hasFeature(shop, feature));
}

/**
 * Check if a shop has any of the specified features
 *
 * @param shop - Shop object with feature_tags field
 * @param features - Array of feature tags to check
 * @returns true if shop has AT LEAST ONE of the specified features
 *
 * @example
 * ```typescript
 * if (hasAnyFeature(shop, [FEATURE_TAGS.EXTERNAL_QR_CODES, FEATURE_TAGS.ADVANCED_ANALYTICS])) {
 *   // Shop has at least one premium feature
 * }
 * ```
 */
export function hasAnyFeature(
  shop: { feature_tags?: any } | null | undefined,
  features: string[]
): boolean {
  return features.some(feature => hasFeature(shop, feature));
}
