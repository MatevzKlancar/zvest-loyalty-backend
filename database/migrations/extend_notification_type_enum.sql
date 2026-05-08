-- Migration: Add daily_meal and specials to the notification type taxonomy
-- Description: Extends notification_templates.type CHECK with two new categories.
--   push_notifications.notification_type is free-form varchar with no CHECK,
--   so no constraint change needed there — it just starts seeing the new values.
-- Date: 2026-05-08

ALTER TABLE public.notification_templates
  DROP CONSTRAINT IF EXISTS notification_templates_type_check;

ALTER TABLE public.notification_templates
  ADD CONSTRAINT notification_templates_type_check
  CHECK (type::text = ANY (ARRAY[
    'birthday'::character varying,
    'manual'::character varying,
    'points_earned'::character varying,
    'coupon_ready'::character varying,
    'daily_meal'::character varying,
    'specials'::character varying
  ]::text[]));

COMMENT ON COLUMN public.notification_templates.type IS
  'Notification category. birthday/coupon_ready/points_earned are personal (immediate). daily_meal/specials/manual are batchable (eligible for cross-shop digest in a follow-up).';
