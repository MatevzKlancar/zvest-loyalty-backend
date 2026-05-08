-- Migration: Weekly notification plans
-- Description: Recurring "weekly schedule" of pushes. A plan has up to 7 entries
--   (one per day-of-week). The materializer job (src/jobs/materialize-notification-plans.ts)
--   runs once a day, finds today's matching entries, and inserts rows into
--   scheduled_notifications with the right UTC timestamp. The existing dispatcher
--   then sends them. No new send path.
-- Date: 2026-05-08

CREATE TABLE IF NOT EXISTS public.notification_plans (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  shop_id uuid NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Europe/Ljubljana',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_plans_pkey PRIMARY KEY (id),
  CONSTRAINT notification_plans_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS notification_plans_shop_id_idx
  ON public.notification_plans (shop_id);

CREATE INDEX IF NOT EXISTS notification_plans_active_idx
  ON public.notification_plans (is_active) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.notification_plan_entries (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  plan_id uuid NOT NULL,
  day_of_week integer NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  send_time_local time without time zone NOT NULL,
  notification_type character varying NOT NULL CHECK (notification_type::text = ANY (ARRAY[
    'manual'::character varying,
    'daily_meal'::character varying,
    'specials'::character varying
  ]::text[])),
  title character varying NOT NULL,
  body text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_plan_entries_pkey PRIMARY KEY (id),
  CONSTRAINT notification_plan_entries_plan_id_fkey
    FOREIGN KEY (plan_id) REFERENCES public.notification_plans(id) ON DELETE CASCADE,
  CONSTRAINT notification_plan_entries_plan_dow_unique UNIQUE (plan_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS notification_plan_entries_plan_id_idx
  ON public.notification_plan_entries (plan_id);

-- Hot path for the materializer: "give me all active entries for today's day-of-week
-- across active plans".
CREATE INDEX IF NOT EXISTS notification_plan_entries_dow_active_idx
  ON public.notification_plan_entries (day_of_week)
  WHERE is_active = true;

COMMENT ON TABLE public.notification_plans IS
  'Recurring weekly notification schedule per shop. Materialized into scheduled_notifications daily.';

COMMENT ON COLUMN public.notification_plans.timezone IS
  'IANA tz name. send_time_local on entries is interpreted in this zone, then converted to UTC at materialize time.';

COMMENT ON TABLE public.notification_plan_entries IS
  'Per-day-of-week entries of a plan. day_of_week 0=Sunday..6=Saturday (Postgres extract(dow) convention).';
