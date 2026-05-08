-- Migration: Per-user, per-shop notification subscriptions ("favorites")
-- Description: Replaces the implicit "loyalty account = push consent" model.
--   A row's existence = the user has favorited the shop. The categories JSONB
--   gates per-category opt-in within that favorite. No row = no push, ever
--   (including birthday). This table is empty on rollout — the app's favorites
--   UI populates it. Push delivery stays gated by the global env switch.
-- Date: 2026-05-08

CREATE TABLE IF NOT EXISTS public.user_shop_notification_preferences (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  app_user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  categories jsonb NOT NULL DEFAULT '{
    "daily_meal": true,
    "specials": true,
    "birthday": true,
    "coupon_ready": true,
    "manual": true,
    "points_earned": true
  }'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_shop_notification_preferences_pkey PRIMARY KEY (id),
  CONSTRAINT user_shop_notification_preferences_user_shop_unique UNIQUE (app_user_id, shop_id),
  CONSTRAINT user_shop_notification_preferences_app_user_id_fkey
    FOREIGN KEY (app_user_id) REFERENCES public.app_users(id) ON DELETE CASCADE,
  CONSTRAINT user_shop_notification_preferences_shop_id_fkey
    FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_shop_notif_prefs_shop_id_idx
  ON public.user_shop_notification_preferences (shop_id);

CREATE INDEX IF NOT EXISTS user_shop_notif_prefs_app_user_id_idx
  ON public.user_shop_notification_preferences (app_user_id);

-- GIN index for fast category lookups (e.g. WHERE categories->>'daily_meal' = 'true')
CREATE INDEX IF NOT EXISTS user_shop_notif_prefs_categories_idx
  ON public.user_shop_notification_preferences USING gin(categories);

COMMENT ON TABLE public.user_shop_notification_preferences IS
  'User-shop favorite + per-category notification preferences. Row existence = favorited. No row = no push.';

COMMENT ON COLUMN public.user_shop_notification_preferences.categories IS
  'Per-category opt-in flags. Keys: daily_meal, specials, birthday, coupon_ready, manual, points_earned. Default all true on favorite.';
