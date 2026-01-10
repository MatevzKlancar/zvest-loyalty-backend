-- Migration: Add custom URL slugs and automated shop support
-- Date: 2025-01-10
-- Description: Adds custom_slug for friendly URLs and is_automated for Google Maps imports

-- 1. Add custom_slug column for friendly URLs
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS custom_slug VARCHAR(100);

-- Add unique constraint on custom_slug (allows NULL, enforces uniqueness on non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS shops_custom_slug_unique_idx
ON public.shops(custom_slug)
WHERE custom_slug IS NOT NULL;

-- Add check constraint for slug format (lowercase alphanumeric with hyphens)
ALTER TABLE public.shops
ADD CONSTRAINT IF NOT EXISTS shops_custom_slug_format_check
CHECK (custom_slug IS NULL OR custom_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

-- 2. Add is_automated flag for Google Maps imports
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS is_automated BOOLEAN DEFAULT false;

-- 3. Add automated_source to track import origin
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS automated_source VARCHAR(50);

ALTER TABLE public.shops
ADD CONSTRAINT IF NOT EXISTS shops_automated_source_check
CHECK (automated_source IS NULL OR automated_source IN ('google_maps', 'manual'));

-- 4. Add external_place_id for Google Place ID reference
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS external_place_id VARCHAR(255);

-- 5. Update status enum to include 'automated'
ALTER TABLE public.shops DROP CONSTRAINT IF EXISTS shops_status_check;
ALTER TABLE public.shops ADD CONSTRAINT shops_status_check
CHECK (status::text = ANY (ARRAY[
  'pending'::character varying,
  'pending_setup'::character varying,
  'active'::character varying,
  'suspended'::character varying,
  'inactive'::character varying,
  'automated'::character varying
]::text[]));

-- 6. Add composite index for efficient listing queries (partners first, then by date)
CREATE INDEX IF NOT EXISTS shops_automated_created_idx
ON public.shops(is_automated, created_at DESC);

-- 7. Add index on external_place_id for duplicate detection
CREATE INDEX IF NOT EXISTS shops_external_place_id_idx
ON public.shops(external_place_id)
WHERE external_place_id IS NOT NULL;

-- 8. Add comments for documentation
COMMENT ON COLUMN public.shops.custom_slug IS
  'Optional custom URL slug for friendly shop URLs (e.g., /shop/cafe-central instead of /shop/uuid). Must be lowercase alphanumeric with hyphens.';

COMMENT ON COLUMN public.shops.is_automated IS
  'Whether this shop was auto-imported (e.g., from Google Maps) vs being a real Zvest partner. Automated shops appear after partners in listings.';

COMMENT ON COLUMN public.shops.automated_source IS
  'Source of automated import: google_maps, manual. NULL for partner shops.';

COMMENT ON COLUMN public.shops.external_place_id IS
  'External reference ID (e.g., Google Place ID) for tracking imported shops and preventing duplicates.';
