-- Migration: Add feature tags system for flexible feature management
-- Description: Replaces individual boolean flags with a scalable JSONB array of feature tags
-- Date: 2025-11-29

-- Add feature_tags column to shops table
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS feature_tags jsonb DEFAULT '[]'::jsonb;

-- Migrate existing external_qr_codes_enabled boolean to feature tags
UPDATE public.shops
SET feature_tags = '["external-qr-codes"]'::jsonb
WHERE external_qr_codes_enabled = true
  AND (feature_tags IS NULL OR feature_tags = '[]'::jsonb);

-- Add GIN index for efficient JSONB array queries
CREATE INDEX IF NOT EXISTS shops_feature_tags_idx
ON public.shops USING gin(feature_tags);

-- Add comment to document the feature
COMMENT ON COLUMN public.shops.feature_tags IS
  'Array of enabled features for this shop. Examples: ["external-qr-codes", "advanced-analytics", "multi-location"]. Used by both frontend and backend for feature gating.';

-- Note: Keeping external_qr_codes_enabled for backward compatibility
-- It can be removed in a future migration after all code is updated
COMMENT ON COLUMN public.shops.external_qr_codes_enabled IS
  'DEPRECATED: Use feature_tags array instead. Kept for backward compatibility.';
