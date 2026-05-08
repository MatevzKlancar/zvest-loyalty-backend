-- Migration: Birthday coupon support
-- Description: Adds two small things that together let shops offer a birthday-only coupon:
--   1. coupons.is_birthday_only — visibility flag. The app hides these from the
--      general coupon list and only shows them when today matches the user's DOB.
--   2. notification_templates.coupon_id — birthday templates can point at a specific
--      coupon so the push deep-links to it. coupon_validity_days kept optional in case
--      we want to override the coupon's own expires_at later (not used in v1).
-- No new tables. POS redemption logic unchanged. One-time-use enforcement happens in
-- the app-side redeem flow by counting existing coupon_redemptions per (coupon, user).
-- Date: 2026-05-08

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS is_birthday_only boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS coupons_is_birthday_only_idx
  ON public.coupons (shop_id) WHERE is_birthday_only = true;

ALTER TABLE public.notification_templates
  ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.coupons.is_birthday_only IS
  'When true, this coupon is hidden from the general coupon list and only visible to users whose date_of_birth month+day matches today. Each user can redeem it once per lifetime (enforced by the app-side redeem flow counting coupon_redemptions per (coupon_id, app_user_id)).';

COMMENT ON COLUMN public.notification_templates.coupon_id IS
  'Optional: when set on a birthday template, the push payload carries {coupon_id} so the native app can deep-link to the coupon. The coupon should usually have is_birthday_only=true.';
