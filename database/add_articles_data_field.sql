-- Add support for multi-article coupons
-- This adds an optional articles_data field to store multiple article discounts

-- Add articles_data JSON field to store multiple article discounts
ALTER TABLE coupons 
ADD COLUMN IF NOT EXISTS articles_data JSONB;

-- Add comment to explain the field
COMMENT ON COLUMN coupons.articles_data IS 'JSON array for multi-article coupons. Format: [{"article_id": "uuid", "article_name": "Coffee", "discount_value": 100}]. When present, this overrides the single article_id/value fields.';

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_coupons_articles_data ON coupons USING GIN (articles_data);

-- Example usage:
-- UPDATE coupons SET articles_data = '[
--   {"article_id": "coffee-uuid", "article_name": "Coffee", "discount_value": 100},
--   {"article_id": "croissant-uuid", "article_name": "Croissant", "discount_value": 50}
-- ]'::jsonb WHERE id = 'your-coupon-id';