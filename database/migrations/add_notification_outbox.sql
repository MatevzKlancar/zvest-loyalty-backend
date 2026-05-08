-- Migration: Cross-shop notification digest outbox
-- Description: When the dispatcher picks up a daily_meal/specials send, instead
--   of fanning out to Expo immediately, it stages one row per recipient into
--   notification_outbox. A separate digest job (every minute) groups queued
--   rows by (app_user_id, digest_window_at) and either sends one push per row
--   (single source) or a single bundled push (multiple sources) so a user
--   following 3 shops gets one push, not three.
-- Date: 2026-05-08

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  app_user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  source_scheduled_id uuid,                   -- FK scheduled_notifications, nullable for direct staging
  source character varying NOT NULL DEFAULT 'scheduled' CHECK (source::text = ANY (ARRAY[
    'scheduled'::character varying,
    'plan'::character varying,
    'manual'::character varying
  ]::text[])),
  notification_type character varying NOT NULL,
  title character varying NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  digest_window_at timestamp with time zone NOT NULL, -- bucket for collation; rounded to 5-min
  status character varying NOT NULL DEFAULT 'queued' CHECK (status::text = ANY (ARRAY[
    'queued'::character varying,
    'sent'::character varying,
    'skipped'::character varying
  ]::text[])),
  batch_id uuid,                              -- set when collapsed into a digest push
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT notification_outbox_app_user_id_fkey
    FOREIGN KEY (app_user_id) REFERENCES public.app_users(id) ON DELETE CASCADE,
  CONSTRAINT notification_outbox_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE,
  CONSTRAINT notification_outbox_source_scheduled_fkey
    FOREIGN KEY (source_scheduled_id) REFERENCES public.scheduled_notifications(id) ON DELETE SET NULL
);

-- Hot path: digest job pulls queued rows whose window is now/past, grouped by user.
CREATE INDEX IF NOT EXISTS notification_outbox_due_idx
  ON public.notification_outbox (digest_window_at, app_user_id)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS notification_outbox_user_idx
  ON public.notification_outbox (app_user_id, status);

-- Trace which final push belonged to which digest. Same batch_id appears on the
-- outbox rows that collapsed into it AND on the resulting push_notifications row(s).
ALTER TABLE public.push_notifications
  ADD COLUMN IF NOT EXISTS batch_id uuid;

CREATE INDEX IF NOT EXISTS push_notifications_batch_id_idx
  ON public.push_notifications (batch_id) WHERE batch_id IS NOT NULL;

COMMENT ON TABLE public.notification_outbox IS
  'Per-recipient staging table for batchable pushes (daily_meal, specials). The digest job collapses rows in the same digest_window_at into one push per user.';

COMMENT ON COLUMN public.notification_outbox.digest_window_at IS
  'Rounded-down 5-min bucket. Two shops sending around 11:30 land in the same bucket and are bundled into one push.';

COMMENT ON COLUMN public.push_notifications.batch_id IS
  'Groups push_notifications rows that were sent as a single Expo message (digest). Also referenced from notification_outbox.batch_id.';
