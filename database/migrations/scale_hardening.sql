-- Migration: Push notification scale + safety hardening
-- Description: Adds index on push_tokens(app_user_id), persists expo_push_token on
--   push_notifications rows (so the receipt checker can deactivate dead tokens),
--   and extends the status CHECK with 'dry_run' for the global delivery kill switch.
-- Date: 2026-05-08

-- 1. Index for token lookups by user (sendToUsers does an IN(...) on app_user_id)
CREATE INDEX IF NOT EXISTS push_tokens_app_user_id_idx
  ON public.push_tokens (app_user_id);

-- 2. Persist the token alongside each notification record so the receipt checker
--    can mark DeviceNotRegistered tokens inactive. Nullable: historical rows
--    pre-migration won't have it.
ALTER TABLE public.push_notifications
  ADD COLUMN IF NOT EXISTS expo_push_token character varying;

CREATE INDEX IF NOT EXISTS push_notifications_expo_push_token_idx
  ON public.push_notifications (expo_push_token)
  WHERE expo_push_token IS NOT NULL;

-- 3. Extend status CHECK to include 'dry_run' for the kill-switch path.
--    When PUSH_NOTIFICATIONS_DELIVERY_ENABLED is false, the service writes rows
--    with this status instead of calling Expo. Receipt checker must skip these.
ALTER TABLE public.push_notifications
  DROP CONSTRAINT IF EXISTS push_notifications_status_check;

ALTER TABLE public.push_notifications
  ADD CONSTRAINT push_notifications_status_check
  CHECK (status::text = ANY (ARRAY[
    'pending'::character varying,
    'sent'::character varying,
    'delivered'::character varying,
    'failed'::character varying,
    'error'::character varying,
    'dry_run'::character varying
  ]::text[]));

COMMENT ON COLUMN public.push_notifications.expo_push_token IS
  'Token the message was sent to. Used by the receipt checker to deactivate tokens that come back DeviceNotRegistered.';

COMMENT ON COLUMN public.push_notifications.status IS
  'pending | sent | delivered | failed | error | dry_run. dry_run = built but not dispatched (kill switch off).';
