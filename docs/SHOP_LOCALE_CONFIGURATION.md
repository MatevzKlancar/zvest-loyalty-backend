# Shop Locale Configuration

This document explains how to configure the language/locale for POS staff-facing error messages.

## Overview

The system supports multiple languages for error messages shown to POS staff members:

- **Slovenian (sl)** - Default language
- **English (en)** - Alternative language

## How Locale is Determined

The system determines which language to use in this order:

1. **Shop Settings** - Check the shop's `settings.locale` or `settings.staff_language` field
2. **Default** - Fall back to Slovenian (`sl`)

## Configuring Shop Locale

### Option 1: Via Admin Dashboard

Shop owners can set their preferred language through the admin dashboard by updating their shop settings.

### Option 2: Via Database (Admin Only)

Update the shop's settings directly:

```sql
-- Set shop to use English for staff messages
UPDATE shops
SET settings = jsonb_set(
    COALESCE(settings, '{}'),
    '{locale}',
    '"en"'
)
WHERE id = 'your-shop-uuid';

-- Set shop to use Slovenian (default)
UPDATE shops
SET settings = jsonb_set(
    COALESCE(settings, '{}'),
    '{locale}',
    '"sl"'
)
WHERE id = 'your-shop-uuid';
```

### Option 3: Via API

```javascript
// Update shop settings via API
PATCH /api/admin/shops/{shop_id}
{
  "settings": {
    "locale": "en"  // or "sl" for Slovenian
  }
}
```

## Supported Locale Values

The system accepts these locale values:

**For Slovenian:**

- `"sl"`
- `"slovenian"`
- `"slovene"`

**For English:**

- `"en"`
- `"english"`

## Example Error Messages

### Slovenian (Default)

```json
{
  "valid": false,
  "error_code": "coupon_expired",
  "error_message": "Kupon je potekel."
}
```

### English

```json
{
  "valid": false,
  "error_code": "coupon_expired",
  "error_message": "Coupon has expired."
}
```

## Available Error Messages

| Error Code                      | Slovenian                          | English                                    |
| ------------------------------- | ---------------------------------- | ------------------------------------------ |
| `coupon_not_found`              | "Kupon ne obstaja."                | "Coupon not found."                        |
| `coupon_expired`                | "Kupon je potekel."                | "Coupon has expired."                      |
| `coupon_already_used`           | "Kupon je že bil uporabljen."      | "Coupon has already been used."            |
| `coupon_code_too_short`         | "Koda za kupon je prekratka."      | "Coupon code is too short."                |
| `coupon_code_too_long`          | "Koda za kupon je predolga."       | "Coupon code is too long."                 |
| `transaction_duplicate_invoice` | "Račun s to številko že obstaja."  | "Invoice with this number already exists." |
| `transaction_already_processed` | "Transakcija je že bila obdelana." | "Transaction has already been processed."  |

## Implementation Notes

- POS hardware doesn't have browser locale detection, so we use shop-level configuration
- Each shop location can have its own language preference
- The locale is determined when the POS system makes API calls using the `shop_id`
- All business logic error messages (HTTP 200 responses) are localized
- Technical errors (HTTP 4xx/5xx) remain in English for debugging purposes

