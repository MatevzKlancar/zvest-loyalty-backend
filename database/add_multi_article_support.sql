-- Add multi-article support to coupons table
-- This migration adds the articles_data field to store multiple article discounts

-- Add articles_data JSON field to store multiple article discounts
ALTER TABLE coupons 
ADD COLUMN IF NOT EXISTS articles_data JSONB;

-- Add comment to explain the field
COMMENT ON COLUMN coupons.articles_data IS 'JSON array for multi-article coupons. Format: [{"article_id": "uuid", "article_name": "Coffee", "discount_value": 100}]. When present, this overrides the single value field.';

-- Add index for performance when querying multi-article coupons
CREATE INDEX IF NOT EXISTS idx_coupons_articles_data ON coupons USING GIN (articles_data);

-- Example usage for multi-article coupon:
-- UPDATE coupons 
-- SET articles_data = '[
--   {"article_id": "coffee-uuid", "article_name": "Coffee", "discount_value": 100},
--   {"article_id": "croissant-uuid", "article_name": "Croissant", "discount_value": 50}
-- ]'::jsonb 
-- WHERE code = 'COFFEE_CROISSANT_DEAL';

-- Verification query to check the new column was added:
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'coupons' AND column_name = 'articles_data';