-- Migration: Scheduled notification queue
-- Description: Holds notifications a shop admin queued for future delivery.
--   The dispatcher job (src/jobs/dispatch-scheduled-notifications.ts) picks up
--   rows where scheduled_for <= now() AND status='scheduled' every minute.
--   Send-now broadcasts skip this table entirely.
-- Date: 2026-05-08

CREATE TABLE IF NOT EXISTS public.scheduled_notifications (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  shop_id uuid NOT NULL,
  notification_type character varying NOT NULL CHECK (notification_type::text = ANY (ARRAY[
    'manual'::character varying,
    'daily_meal'::character varying,
    'specials'::character varying
  ]::text[])),
  title character varying NOT NULL,
  body text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  scheduled_for timestamp with time zone NOT NULL,
  status character varying NOT NULL DEFAULT 'scheduled'::character varying CHECK (status::text = ANY (ARRAY[
    'scheduled'::character varying,
    'sending'::character varying,
    'sent'::character varying,
    'cancelled'::character varying,
    'failed'::character varying
  ]::text[])),
  recipient_count integer,
  sent_at timestamp with time zone,
  error_message text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT scheduled_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_notifications_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE
);

-- Hot path for the dispatcher: find scheduled rows that are due
CREATE INDEX IF NOT EXISTS scheduled_notifications_due_idx
  ON public.scheduled_notifications (scheduled_for)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS scheduled_notifications_shop_id_idx
  ON public.scheduled_notifications (shop_id, scheduled_for DESC);

COMMENT ON TABLE public.scheduled_notifications IS
  'Future-dated broadcasts queued by shop admins. Dispatcher cron picks up due rows; send-now broadcasts skip this table.';
