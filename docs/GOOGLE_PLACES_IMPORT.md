# Google Places Import Guide

Quick reference for importing and managing stores via Google Places API.

## Database: Supabase MCP

**Project ID:** `ftkbnhykzolazrrmucpw`

## Key Tables

### `shops` table - Important columns for Google imports:

| Column | Type | Description |
|--------|------|-------------|
| `name` | text | Shop name |
| `address` | text | Full address |
| `phone` | text | Phone number |
| `website` | text | Website URL |
| `opening_hours` | text | Newline-separated weekly hours |
| `image_url` | text | Google photo URL |
| `rating` | decimal | Google rating (1.0-5.0) |
| `rating_count` | int | Number of Google reviews |
| `price_level` | int | 1-4 (€ to €€€€) |
| `google_maps_url` | text | Direct link to Google Maps |
| `shop_category` | text | cafe, bar, restaurant, bakery, wellness, pastry, retail, other |
| `is_automated` | boolean | `true` = Google import (not a partner), `false` = real partner |
| `automated_source` | text | "google_maps" for imports |
| `external_place_id` | text | Google Place ID (for duplicate detection) |
| `status` | text | "active" (partner) or "automated" (Google import) |

## Common Operations

### 1. Check existing stores for a city

```sql
SELECT name, rating, shop_category, is_automated
FROM shops
WHERE address ILIKE '%Ljubljana%'
ORDER BY rating DESC;
```

### 2. Update a store with Google data

First search Google to get the data:
```sql
-- Then update manually:
UPDATE shops
SET
  opening_hours = 'ponedeljek: 8:00–18:00
torek: 8:00–18:00
sreda: 8:00–18:00
četrtek: 8:00–18:00
petek: 8:00–18:00
sobota: 9:00–14:00
nedelja: Zaprto',
  rating = 4.7,
  rating_count = 523,
  address = 'Full address from Google'
WHERE name = 'Shop Name'
RETURNING *;
```

### 3. Fix missing photos

```sql
UPDATE shops
SET image_url = 'https://lh3.googleusercontent.com/places/...'
WHERE name = 'Shop Name';
```

### 4. Convert automated shop to real partner

```sql
UPDATE shops
SET
  is_automated = false,
  status = 'active',
  automated_source = NULL
WHERE id = 'shop-uuid-here';
```

### 5. Count stores by city

```sql
SELECT
  CASE
    WHEN address ILIKE '%Ljubljana%' THEN 'Ljubljana'
    WHEN address ILIKE '%Maribor%' THEN 'Maribor'
    WHEN address ILIKE '%Celje%' THEN 'Celje'
    WHEN address ILIKE '%Grosuplje%' THEN 'Grosuplje'
    ELSE 'Other'
  END as city,
  COUNT(*) as count
FROM shops
WHERE status IN ('active', 'automated')
GROUP BY city
ORDER BY count DESC;
```

### 6. Find stores without photos

```sql
SELECT name, address FROM shops
WHERE image_url IS NULL OR image_url = ''
ORDER BY created_at DESC;
```

### 7. Find stores without opening hours

```sql
SELECT name, address FROM shops
WHERE opening_hours IS NULL OR opening_hours = ''
ORDER BY created_at DESC;
```

## API Endpoints (when server is running)

### Search Google Places
```bash
POST http://localhost:3000/api/admin/google/search
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "query": "kavarne Ljubljana",
  "location": {
    "latitude": 46.0569,
    "longitude": 14.5058,
    "radiusMeters": 5000
  },
  "maxResults": 10
}
```

### Import single place
```bash
POST http://localhost:3000/api/admin/google/import
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "place": { ...place object from search... }
}
```

### Bulk import
```bash
POST http://localhost:3000/api/admin/google/bulk-import
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "places": [ ...array of place objects... ]
}
```

## Slovenian Cities Coordinates

| City | Latitude | Longitude |
|------|----------|-----------|
| Ljubljana | 46.0569 | 14.5058 |
| Maribor | 46.5547 | 15.6459 |
| Celje | 46.2364 | 15.2677 |
| Kranj | 46.2389 | 14.3556 |
| Koper | 45.5469 | 13.7294 |
| Grosuplje | 45.9556 | 14.6589 |
| Novo Mesto | 45.8014 | 15.1689 |
| Ptuj | 46.4200 | 15.8700 |
| Nova Gorica | 45.9558 | 13.6419 |
| Bled | 46.3683 | 14.1144 |

## Search Terms (Slovenian works better)

| Category | Search Term |
|----------|-------------|
| Cafe | kavarna |
| Restaurant | restavracija |
| Bar | bar, lounge |
| Pub | gostilna |
| Bakery | pekarna |
| Pastry | slaščičarna |
| Pizza | pizzerija |
| Burger | burger |
| Hairdresser | frizer |
| Barber | brivnica |
| Massage | masaža |
| Wellness | wellness, spa |

## Opening Hours Format

Google returns opening hours as newline-separated text:
```
ponedeljek: 8:00–18:00
torek: 8:00–18:00
sreda: 8:00–18:00
četrtek: 8:00–18:00
petek: 8:00–18:00
sobota: 9:00–14:00
nedelja: Zaprto
```

Store this exactly as-is in the `opening_hours` column.

## Shop Categories

Valid values for `shop_category`:
- `cafe`
- `bar`
- `restaurant`
- `bakery`
- `pastry`
- `wellness`
- `retail`
- `other`

## Status Values

- `active` - Real partner shop, fully operational
- `automated` - Google Maps import, not a real partner (view-only)
- `pending` - Awaiting setup
- `suspended` - Temporarily disabled

## Quick Fixes

### Shop not showing in app?
Check `status` is either `active` or `automated`:
```sql
SELECT name, status, is_automated FROM shops WHERE name ILIKE '%shop name%';
```

### Wrong category?
```sql
UPDATE shops SET shop_category = 'cafe' WHERE name = 'Shop Name';
```

### Missing rating?
```sql
UPDATE shops SET rating = 4.5, rating_count = 100 WHERE name = 'Shop Name';
```
