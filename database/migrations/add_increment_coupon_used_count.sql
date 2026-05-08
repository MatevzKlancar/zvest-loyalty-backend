-- Atomic increment for coupons.used_count
--
-- Why: validate-coupon was never incrementing used_count, leaving it permanently
-- at 0 for every coupon. A read-modify-write update has a race condition under
-- concurrent redemptions; an UPDATE ... SET used_count = used_count + 1 inside
-- a SQL function is atomic.
--
-- Called from src/routes/pos.ts validate-coupon handler after the redemption is
-- marked as 'used'. Best-effort: if this fails, the coupon is still considered
-- successfully redeemed — we just lose one analytics increment.

CREATE OR REPLACE FUNCTION public.increment_coupon_used_count(p_coupon_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.coupons
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE id = p_coupon_id;
$$;

GRANT EXECUTE ON FUNCTION public.increment_coupon_used_count(uuid) TO service_role;
