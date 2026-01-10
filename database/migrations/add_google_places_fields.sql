-- Migration: Add Google Places fields for imported shop data
-- Date: 2025-01-10
-- Description: Adds rating, rating_count, price_level, google_maps_url for Google Places imports

-- 1. Add rating field (1.0 - 5.0 scale from Google)
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS rating DECIMAL(2,1) CHECK (rating >= 1.0 AND rating <= 5.0);

-- 2. Add rating count (number of Google reviews)
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS rating_count INTEGER CHECK (rating_count >= 0);

-- 3. Add price level (1-4 scale: € to €€€€)
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS price_level INTEGER CHECK (price_level >= 1 AND price_level <= 4);

-- 4. Add Google Maps URL for "View on Google Maps" link
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS google_maps_url VARCHAR(500);

-- 5. Add comments for documentation
COMMENT ON COLUMN public.shops.rating IS
  'Google Places rating (1.0-5.0 scale). NULL for shops without Google data.';

COMMENT ON COLUMN public.shops.rating_count IS
  'Number of Google reviews. Used to display "Based on X reviews".';

COMMENT ON COLUMN public.shops.price_level IS
  'Price level from Google (1=€, 2=€€, 3=€€€, 4=€€€€). NULL if not available.';

COMMENT ON COLUMN public.shops.google_maps_url IS
  'Direct link to the shop on Google Maps. Populated during Google Places import.';
