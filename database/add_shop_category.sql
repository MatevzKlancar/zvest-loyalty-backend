-- Add shop_category column to shops table
-- This allows filtering shops by category in the native app

-- Add the shop_category column with CHECK constraint for allowed values
ALTER TABLE shops
ADD COLUMN shop_category VARCHAR CHECK (
  shop_category IN (
    'bar',
    'restaurant',
    'bakery',
    'wellness',
    'pastry',
    'cafe',
    'retail',
    'other'
  )
);

-- Add brand_color column for shop owners to customize their brand color
ALTER TABLE shops
ADD COLUMN brand_color VARCHAR(7);

-- Create an index for faster filtering by category
CREATE INDEX idx_shops_category ON shops(shop_category);

-- Add comments to document the columns
COMMENT ON COLUMN shops.shop_category IS 'Category of the shop for filtering in native app (bar, restaurant, bakery, wellness, pastry, cafe, retail, other)';
COMMENT ON COLUMN shops.brand_color IS 'Brand color in hex format (e.g., #FF5733) for customizing shop appearance in app';
