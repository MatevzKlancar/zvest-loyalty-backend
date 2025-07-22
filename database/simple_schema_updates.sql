-- ===================================================================
-- ZVEST COUPON SYSTEM - SIMPLE DATABASE UPDATES
-- ===================================================================
-- This script only updates table structure and constraints.
-- All logic will be handled server-side for better maintainability.
-- ===================================================================

-- ===================================================================
-- 1. UPDATE COUPONS TABLE CONSTRAINTS
-- ===================================================================

-- Remove old type constraint
ALTER TABLE coupons 
DROP CONSTRAINT IF EXISTS coupons_type_check;

-- Add new constraint (only percentage and fixed allowed)
ALTER TABLE coupons 
ADD CONSTRAINT coupons_type_check 
CHECK (type IN ('percentage', 'fixed'));

-- ===================================================================
-- 2. CLEANUP EXISTING DATA (Optional - only if you have existing coupons)
-- ===================================================================

-- Convert existing 'free_item' coupons to 100% percentage coupons
UPDATE coupons 
SET type = 'percentage', value = 100 
WHERE type = 'free_item';

-- Deactivate 'points_multiplier' coupons
UPDATE coupons 
SET is_active = false 
WHERE type = 'points_multiplier';

-- ===================================================================
-- 3. VERIFY COUPON_REDEMPTIONS TABLE EXISTS WITH CORRECT STRUCTURE
-- ===================================================================

-- Check if coupon_redemptions table exists, if not create it
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id TEXT PRIMARY KEY,  -- This will store our 6-digit codes like "394750"
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  app_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  points_deducted INTEGER DEFAULT 0 CHECK (points_deducted >= 0),
  discount_applied NUMERIC(10,2) DEFAULT 0 CHECK (discount_applied >= 0),
  redeemed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_id ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_app_user_id ON coupon_redemptions(app_user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_status ON coupon_redemptions(status);

-- ===================================================================
-- VERIFICATION QUERIES (Optional - to check your data)
-- ===================================================================

-- Check coupon types are now limited
-- SELECT DISTINCT type FROM coupons;
-- Expected: Only 'percentage' and 'fixed'

-- Check if any redemptions exist  
-- SELECT COUNT(*) as total_redemptions FROM coupon_redemptions;

-- ===================================================================
-- SCRIPT COMPLETE ✅
-- ===================================================================
-- Database is ready. All smart logic will be handled server-side.
-- =================================================================== 