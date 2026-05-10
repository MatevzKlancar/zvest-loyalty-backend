-- Allow authenticated users to SELECT their own coupon_redemptions rows.
-- This is what the native app needs for the realtime subscription on
-- active-coupon status (active -> used/expired/cancelled). Realtime UPDATE
-- delivery requires a SELECT policy on the row.
--
-- Writes still go through the service role via /api/pos/* — no INSERT/UPDATE
-- policies for authenticated.
--
-- Mirrors the email-based identity check used by app_users_select_own.

CREATE POLICY "coupon_redemptions_select_own" ON public.coupon_redemptions
  FOR SELECT TO authenticated
  USING (
    app_user_id IN (
      SELECT id FROM public.app_users
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  );
