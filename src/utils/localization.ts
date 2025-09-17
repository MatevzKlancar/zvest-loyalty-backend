/**
 * Localization utility for Slovenian error messages
 * Used specifically for POS staff-facing error messages
 */

export interface LocalizedErrorMessages {
  // Coupon validation errors
  coupon_not_found: string;
  coupon_expired: string;
  coupon_already_used: string;
  coupon_invalid_format: string;
  coupon_code_too_short: string;
  coupon_code_too_long: string;
  coupon_insufficient_points: string;
  coupon_not_active: string;
  article_not_in_system: string;

  // Shop validation errors
  shop_not_found: string;
  shop_not_active: string;
  shop_not_enabled: string;

  // Transaction errors
  transaction_invalid_amount: string;
  transaction_items_required: string;
  transaction_duplicate_invoice: string;
  transaction_already_processed: string;

  // General validation errors
  invalid_shop_id: string;
  pos_invoice_id_required: string;
  redemption_code_required: string;

  // System errors
  internal_server_error: string;
  invalid_api_key: string;
}

// Slovenian error messages for staff
export const slovenianMessages: LocalizedErrorMessages = {
  // Coupon validation errors
  coupon_not_found: "Kupon ne obstaja.",
  coupon_expired: "Kupon je potekel.",
  coupon_already_used: "Kupon je že bil uporabljen.",
  coupon_invalid_format: "Neveljavna oblika kode kupona.",
  coupon_code_too_short: "Koda za kupon je prekratka.",
  coupon_code_too_long: "Koda za kupon je predolga.",
  coupon_insufficient_points: "Stranka nima dovolj točk za ta kupon.",
  coupon_not_active: "Kupon ni aktiven.",
  article_not_in_system: "Artikel ni v sistemu. Prosimo, sinhronizirajte artikle.",

  // Shop validation errors
  shop_not_found: "Trgovina ni najdena.",
  shop_not_active: "Trgovina ni aktivna.",
  shop_not_enabled: "Trgovina ni omogočena za transakcije.",

  // Transaction errors
  transaction_invalid_amount: "Neveljaven znesek transakcije.",
  transaction_items_required: "Potrebni so podatki o artiklih.",
  transaction_duplicate_invoice: "Račun s to številko že obstaja.",
  transaction_already_processed: "Transakcija je že bila obdelana.",

  // General validation errors
  invalid_shop_id: "Neveljaven ID trgovine.",
  pos_invoice_id_required: "Številka računa je obvezna.",
  redemption_code_required: "Koda za unovčitev je obvezna.",

  // System errors
  internal_server_error: "Napaka v sistemu. Kontaktirajte podporo.",
  invalid_api_key: "Neveljaven API ključ.",
};

// English fallback messages (for development/debugging)
export const englishMessages: LocalizedErrorMessages = {
  coupon_not_found: "Coupon not found.",
  coupon_expired: "Coupon has expired.",
  coupon_already_used: "Coupon has already been used.",
  coupon_invalid_format: "Invalid coupon code format.",
  coupon_code_too_short: "Coupon code is too short.",
  coupon_code_too_long: "Coupon code is too long.",
  coupon_insufficient_points:
    "Customer doesn't have enough points for this coupon.",
  coupon_not_active: "Coupon is not active.",
  article_not_in_system: "Article not in system. Please sync articles.",

  shop_not_found: "Shop not found.",
  shop_not_active: "Shop is not active.",
  shop_not_enabled: "Shop is not enabled for transactions.",

  transaction_invalid_amount: "Invalid transaction amount.",
  transaction_items_required: "Transaction items are required.",
  transaction_duplicate_invoice: "Invoice with this number already exists.",
  transaction_already_processed: "Transaction has already been processed.",

  invalid_shop_id: "Invalid shop ID.",
  pos_invoice_id_required: "POS invoice ID is required.",
  redemption_code_required: "Redemption code is required.",

  internal_server_error: "Internal server error. Please contact support.",
  invalid_api_key: "Invalid API key.",
};

export type ErrorCode = keyof LocalizedErrorMessages;

/**
 * Get localized error message
 * @param errorCode - The error code
 * @param locale - The locale (defaults to 'sl' for Slovenian)
 * @returns Localized error message
 */
export function getLocalizedMessage(
  errorCode: ErrorCode,
  locale: "sl" | "en" = "sl"
): string {
  const messages = locale === "sl" ? slovenianMessages : englishMessages;
  return messages[errorCode] || messages.internal_server_error;
}

/**
 * Create a localized error response for POS endpoints
 * @param errorCode - The error code
 * @param locale - The locale (defaults to 'sl' for Slovenian)
 * @returns Error response object
 */
export function createLocalizedError(
  errorCode: ErrorCode,
  locale: "sl" | "en" = "sl"
) {
  return {
    valid: false,
    error_code: errorCode,
    error_message: getLocalizedMessage(errorCode, locale),
  };
}

/**
 * Create a localized validation error message for Zod schemas
 * Used for custom error messages in validation schemas
 */
export function getValidationMessage(
  errorCode: ErrorCode,
  locale: "sl" | "en" = "sl"
): string {
  return getLocalizedMessage(errorCode, locale);
}

/**
 * Get locale from shop settings or fallback to default
 * @param shopSettings - The shop's settings JSONB object
 * @returns The locale to use for this shop
 */
export function getShopLocale(shopSettings: any): "sl" | "en" {
  // Check shop settings for locale preference
  if (shopSettings && typeof shopSettings === "object") {
    const locale = shopSettings.locale || shopSettings.staff_language;
    if (locale === "en" || locale === "english") return "en";
    if (locale === "sl" || locale === "slovenian" || locale === "slovene")
      return "sl";
  }

  // Default to Slovenian (since your business is in Slovenia)
  return "sl";
}

/**
 * Create a localized error response using shop settings
 * @param errorCode - The error code
 * @param shopSettings - The shop's settings object
 * @returns Error response object with appropriate locale
 */
export function createLocalizedErrorForShop(
  errorCode: ErrorCode,
  shopSettings: any
) {
  const locale = getShopLocale(shopSettings);
  return createLocalizedError(errorCode, locale);
}
