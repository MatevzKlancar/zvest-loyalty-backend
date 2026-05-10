Mobile App RLS Audit — Findings

Confirmed via grep: only 5 direct table calls (all on app_users) and 1 realtime subscription (on coupon_redemptions). No  
 supabase.storage, no supabase.rpc. Everything else goes through your backend apiClient and is unaffected.

1. coupon_redemptions realtime — WILL BREAK SILENTLY  


api/coupons/index.ts:73-92 — subscribeToActiveCoupon() subscribes to UPDATE events on coupon_redemptions filtered by  
 id=eq.{redemptionId}.

Consumed by:

- hooks/useActiveCouponRealtime.ts
- hooks/useActiveCouponSync.ts
- hooks/useActiveCouponStatusManager.ts
- app/\_layout.tsx  


This is exactly the case your doc warns about: realtime will silently deliver zero events. The "active coupon" live status  
 (active → used/expired/cancelled) will appear stuck until the user manually refreshes. Action needed: either add an RLS policy
on coupon_redemptions for the owning user, or move this to a backend-pushed signal (push notification / poll endpoint).

2. app_users — likely works, but with a sharp edge

All 5 calls filter by id, not email:

┌───────────────────────┬────────┬────────────────────────────────────────────────┬───────────────────────────────┐  
 │ File:line │ Op │ Filter │ Notes │
├───────────────────────┼────────┼────────────────────────────────────────────────┼───────────────────────────────┤  
 │ api/user/index.ts:34 │ SELECT │ .eq('id', userId) │ getAppUser() │  
 ├───────────────────────┼────────┼────────────────────────────────────────────────┼───────────────────────────────┤
│ api/user/index.ts:62 │ SELECT │ .eq('id', userId) │ existence check before insert │  
 ├───────────────────────┼────────┼────────────────────────────────────────────────┼───────────────────────────────┤  
 │ api/user/index.ts:74 │ INSERT │ sets id: userId, email: userEmail from session │ onboarding │  
 ├───────────────────────┼────────┼────────────────────────────────────────────────┼───────────────────────────────┤  
 │ api/user/index.ts:98 │ UPDATE │ .eq('id', userId) │ profile edits │  
 ├───────────────────────┼────────┼────────────────────────────────────────────────┼───────────────────────────────┤  
 │ api/auth/index.ts:301 │ UPDATE │ .eq('id', data.user.id) │ Apple first-name backfill │  
 └───────────────────────┴────────┴────────────────────────────────────────────────┴───────────────────────────────┘

Your doc is explicit that the RLS policy keys on email == auth.jwt().email, and that app_users.id is a separate UUID, not the  
 auth user's id. The app is built on the implicit assumption that they're equal — the INSERT path on line 77 sets id: userId  
 (the auth user id) for newly created rows, and every read/update queries by that same value.

What this means in practice:

- INSERT: passes — sets email from the session, which matches the JWT email. ✓
- SELECT/UPDATE by id: passes RLS only if the row's email also matches the JWT email. For users this app created itself, id and
  email line up with the same auth user, so it works. For any legacy/imported app_users row where id != auth.uid(), profile  
  reads will return null and updates will silently no-op.  


If your prod data has any rows where app_users.id was generated independently of the auth user id (the doc's warning implies  
 this is possible), those users will see broken profiles after RLS. Worth a quick check: SELECT count(\*) FROM app_users a JOIN  
 auth.users u ON a.email = u.email WHERE a.id <> u.id;

There's also a 500ms setTimeout after Google/Apple sign-in (api/auth/index.ts:195, 289) waiting for "the trigger to create the
user" — confirm that server-side trigger sets email from the auth user, otherwise the subsequent getAppUser will fail RLS even
though the row exists.

3. Everything else — unaffected

No direct SDK calls to customer_loyalty_accounts, transactions, coupons, service_ratings, push_tokens, reservations\*, shops,  
 articles, user_shop_notification_preferences, etc. All of those go through apiClient to your backend (which uses the service
role). No code changes needed for those tables.

No Supabase Storage usage. No .rpc() calls. (api/transactions/index.ts was already deleted per git status.)

Recommended next steps

1. Fix the realtime subscription before you start testing — that's the only guaranteed regression.
2. Run the JOIN above on prod to confirm app_users.id == auth.uid() for all existing rows. If yes, the by-id queries are fine.
   If not, switch the 5 call sites to filter by email from the session.
3. Then run your testing checklist; the auth flows, profile, loyalty, transactions, coupons (activate/list), scan QR, ratings,
   push tokens, and reservations should all work as-is since they're backend-mediated.
