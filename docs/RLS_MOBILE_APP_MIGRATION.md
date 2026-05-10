# RLS Rollout — Mobile App Action Items

## What's changing

We have enabled Row Level Security (RLS) on every table in the `public` schema of our Supabase database. Until now these tables were wide open to anyone with the anon key. They are now **deny-by-default** for the anon and authenticated roles.

> ⚠️ **This is already live on production.** We did the rollout directly on prod because our user base is still small. Please test the app against production and flag any issues immediately — we have a one-line rollback ready.

The backend API is unaffected (it uses the service role, which bypasses RLS). **The only consumer this impacts is the native mobile app**, because it talks to Supabase directly with the anon key.

## What is NOT changing

- **Supabase Auth itself** — `signUp`, `signInWithPassword`, password reset, session refresh, sign out: all unchanged.
- **The anon key** — keep using it.
- **JWT tokens** — issued and validated the same way.
- **Backend API endpoints** — `/api/app/*`, `/api/app-user/*`, `/api/reservations/*`, `/api/public/*` all work the same. Keep using them.

## What WILL break (action required)

Any code that reads or writes a Supabase table directly via the SDK (`supabase.from('...').select()` / `.insert()` / `.update()` / `.delete()`) will start returning empty results or permission errors, **except** for `app_users` (which has policies — see below).

### 1. `app_users` — direct access still works, with one constraint

Authenticated users can read, insert, and update **their own row** (matched by `email == auth.jwt().email`). They cannot see or modify anyone else's row.

What still works as-is:
```ts
// Read your own profile (RLS filters to your row by email)
const { data } = await supabase.from('app_users').select('*').single();

// Update your own profile
await supabase.from('app_users')
  .update({ first_name: 'X' })
  .eq('email', sessionEmail);

// Insert your row right after signUp — email MUST match the auth user's email
await supabase.from('app_users').insert({
  email: sessionEmail,
  first_name, last_name, /* ... */
});
```

Important constraints:
- The `email` column on the `app_users` row must equal the authenticated user's email (case-insensitive). If they don't match, RLS will reject the row.
- You cannot read or modify any other user's `app_users` row. Trying will return empty / a permission error.
- Note: `app_users.id` is a separate UUID, **not** the auth user's id. Keep using `email` (or `app_users.id` once you've fetched your own row) as the identifier.

### 2. Every other table — direct reads/writes will fail

Please confirm whether you are currently calling any of the following directly. If yes, switch to the corresponding backend endpoint. If you only ever go through the backend API, no change needed.

| Table | What you should call instead |
|---|---|
| `customer_loyalty_accounts` | `GET /api/app-user/users/{userId}/loyalty` and `/loyalty/{storeId}` |
| `transactions` | `GET /api/app/transactions/{id}`, `GET /api/app-user/users/{userId}/transactions`, `POST /api/app/scan-qr` |
| `coupons`, `coupon_redemptions` | `GET /api/app/coupons/active`, `POST /api/app/coupons/{couponId}/activate` |
| `service_ratings` | `POST /api/app/ratings` |
| `push_tokens` | `POST /api/app/push-token`, `DELETE /api/app/push-token` |
| `reservations`, `reservation_*` | `/api/reservations/*` (list, get, create, cancel, services, availability) |
| `shops`, `articles`, `article_pricing`, `article_qr_codes`, `loyalty_programs` | `/api/public/*` (no auth required) |
| `user_shop_notification_preferences` | TBD — let us know if you need this; we can add an endpoint |
| `admin_users`, `customers`, `pos_providers`, `transaction_logs`, `notification_*`, `push_notifications` | Internal — never call directly |

### 3. Realtime subscriptions

If the app uses `supabase.channel(...).on('postgres_changes', ...)` on any table, **realtime respects RLS**. After the change:
- Subscriptions on `app_users` for the user's own row still work.
- Subscriptions on any other table will silently deliver zero events.

Please list any realtime subscriptions you have so we can decide per-table whether to add a policy or move to a backend-driven update mechanism.

### 4. Storage

If the app uploads to or reads from any Supabase Storage bucket directly (e.g. `shop-images`), let us know. Bucket policies are being reviewed in the same pass.

## Testing checklist (run against production now)

Please run through these on the live app as soon as possible:

- [ ] Sign up new user → email verification → first login
- [ ] Sign in with existing credentials
- [ ] Password reset flow
- [ ] Profile screen loads (read `app_users`)
- [ ] Profile edit saves (update `app_users`)
- [ ] Loyalty screen loads (per shop and aggregate)
- [ ] Transaction history loads
- [ ] Scan QR → redeem points
- [ ] Activate a coupon
- [ ] Submit a service rating
- [ ] Register / unregister push token
- [ ] Reservation: list, create, cancel
- [ ] Public store browse (no auth)
- [ ] Any realtime feature (live notifications, live transaction updates, etc.)

If anything fails, capture the Supabase error (it usually says `new row violates row-level security policy` or similar) and send it our way.

## Timeline

**RLS is already enabled on production.** We chose to do this directly on prod (rather than staging-first) because the user base is still small enough that any breakage will be caught quickly and the rollback is one SQL block away.

What this means for you:
1. Run the testing checklist above against the **current production app** as soon as you can.
2. If anything is broken, report it immediately with the exact Supabase error message — we will either:
   - Add a targeted policy for the affected table, or
   - Roll back RLS entirely while you adapt the app.
3. Once you've worked through the checklist and any issues, we're done.

**Rollback (kept handy in case we need it):**
```sql
BEGIN;
DROP POLICY IF EXISTS "app_users_select_own" ON public.app_users;
DROP POLICY IF EXISTS "app_users_update_own" ON public.app_users;
DROP POLICY IF EXISTS "app_users_insert_own" ON public.app_users;
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
COMMIT;
```

## Contact

Questions / blockers / "is this table accessed directly?" — reply on this thread.
