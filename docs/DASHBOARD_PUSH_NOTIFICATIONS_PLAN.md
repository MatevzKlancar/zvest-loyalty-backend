# Dashboard — Push Notifications Overhaul

This plan is for the **shop-admin dashboard frontend team**. The backend changes are already shipped. Your job is to extend the existing 4-tab Push Notifications screen (Analytics / Send Notification / Birthday Settings / History) plus the existing Coupons screen to use the new APIs.

The big shifts:

- Notifications no longer go to "every customer with a loyalty account." They go to customers who have **favorited the shop** in the native app and **opted in for the chosen category**. Until the native app ships favorites, every audience count will be **0**. That's expected — the dashboard exists to be ready for that flow.
- Sends are now **categorized** (`manual`, `daily_meal`, `specials`). Manual broadcasts are rate-limited. Categorized sends can be one-off scheduled or part of a recurring **weekly plan**.
- The **Birthday Settings** can now attach a coupon. The coupon is gated on the user's actual birthday and one-time-use.
- A new **Birthday-only** flag exists on coupons themselves (in the Coupons tab).
- A global delivery kill switch (`PUSH_NOTIFICATIONS_DELIVERY_ENABLED`) is currently `false` on the backend, so any send produces a `dry_run` row instead of a real push. Make this visible in the UI so admins aren't confused when their inbox is empty.

---

## Auth & response shape

- All endpoints below require `Authorization: Bearer <shop-owner-JWT>`.
- Response envelope: `{ status: number, message: string, data?: any, error_source?: string }`.
- 4xx and 5xx use the same envelope; check the `status` field, not just HTTP code.
- Base path: `/api/shop-admin/...`

---

## What changes per screen

### Notifications: Tab 1 — **Send Notification**

The current form (Title + Message + Send button) gains:

- A **category** dropdown (required).
- A **schedule** toggle: "Send now" vs "Schedule for later".
- An **audience preview chip** ("This will reach N of your M favorited customers").
- A **quota indicator** ("1 of 2 manual broadcasts used today").
- A **dry-run banner** when delivery is disabled globally.
- A **Weekly plan** section (covered separately below — same tab, distinct UI block).

#### Category dropdown

Required field. Three options:

| Value         | Label             | When to use                                        |
| ------------- | ----------------- | -------------------------------------------------- |
| `manual`      | Announcement      | One-off messages. Rate-limited (1/hour, 2/day).    |
| `daily_meal`  | Daily meal        | Recurring menu-of-the-day pushes.                  |
| `specials`    | Special / promo   | Limited-time offers, new items, events.            |

Place the dropdown **above** the title field. Default to `manual`.

> Why categories: the native app lets users opt out of `daily_meal` while keeping `specials` on. So the same shop's pushes can land for the right people only.

#### Audience preview

When the category changes (and on initial load), call:

```
GET /api/shop-admin/notifications/audience-preview?category={category}
→ {
    "category": "daily_meal",
    "subscribed_count": 412,         // users opted in for this category
    "total_with_loyalty": 1830,      // users with a loyalty account (legacy reach, for context)
    "total_subscribers": 540         // users who favorited the shop (any category)
  }
```

Render under the category dropdown:

> **Reach:** This will be sent to **412 customers** who follow you and have **{Daily meal}** notifications enabled.
>
> *(540 customers follow your shop · 1,830 have a loyalty account)*

When `subscribed_count` is 0 (which it will be at launch until favorites ship in the app), show a soft warning instead:

> **No subscribers yet.** Customers need to favorite your shop in the app to receive notifications. Sending now will succeed but reach 0 people.

Don't block the send — let the admin send anyway (useful for testing). Just make the empty state honest.

#### Schedule toggle

Two-state control: **Send now** (default) | **Schedule**.

When **Schedule** is selected, show a datetime picker. Pass the chosen time as ISO 8601 with timezone (`new Date(...).toISOString()`) in the body field `scheduled_for`. Validate locally that it's in the future before submitting; the backend also enforces this.

#### Quota indicator

Only relevant for the `manual` category. Call:

```
GET /api/shop-admin/notifications/quota
→ {
    "daily_limit": 2,
    "daily_remaining": 1,
    "hourly_limit": 1,
    "can_send_now": true,
    "retry_after_seconds": 0
  }
```

Render next to the Send button:

> *1 of 2 announcements used today*

When `can_send_now` is `false`, disable the Send button and show:

> *Quota reached. You can send another announcement in {format(retry_after_seconds)}.*

Refresh the quota after every successful send. Don't show the quota indicator for `daily_meal` or `specials` — those don't have a rate limit.

#### Submit (send/schedule)

Replace the existing `POST /broadcast` call with:

```
POST /api/shop-admin/notifications/broadcast
Body:
{
  "category": "manual" | "daily_meal" | "specials",
  "title": "...",
  "body": "...",
  "scheduled_for": "2026-05-09T11:30:00.000Z"  // optional; omit for send-now
}
```

Successful response:

```
200 OK
{
  "status": 200,
  "message": "Notification sent successfully" | "Notification scheduled",
  "data": {
    "scheduled": false,
    "scheduled_id": null | "uuid",
    "audience_size": 412,
    "sent": 410,           // present on send-now only
    "failed": 2,           // present on send-now only
    "dry_run": 0,          // present on send-now only; >0 means delivery is disabled
    "daily_quota_remaining": 1
  }
}
```

After a successful **send-now**, show:
- If `dry_run > 0`: a yellow banner — *"Test mode: notification recorded but not delivered to {N} devices. Toggle delivery in backend env to go live."*
- Otherwise: a green toast — *"Sent to {sent} customers. {failed} failed."*

After a successful **schedule**, show:
- Green toast — *"Scheduled for {formatDate}. You can cancel from the History tab."*

429 response (quota exceeded):

```
{
  "status": 429,
  "message": "Broadcast quota exceeded",
  "data": {
    "retry_after_seconds": 3600,
    "daily_quota_remaining": 0
  }
}
```

Show inline error: *"Quota reached. Try again in {format(retry_after_seconds)}."*

#### Dry-run banner

Above the whole Send Notification tab, show a persistent banner whenever the most recent send response has `dry_run > 0`. Once you see one of those responses, store a flag in component state and keep the banner visible for the session. Copy:

> **Test mode active.** Push delivery is currently disabled on the backend. Notifications are recorded in History but no devices receive them. Contact engineering to enable delivery.

This avoids the support thread of "I sent a message and nothing happened."

---

### Notifications: Tab 1 — **Weekly Plan** (new section in Send Notification)

A new section inside the Send Notification tab (or a fifth top-level tab — frontend's call). The mental model: *"every Monday at 11:30, push my daily-meal message; every Tuesday at 11:30, push the Tuesday one; etc. I write it once, it runs forever until I pause it."*

Backend model: a **plan** has a name, timezone, and active flag. It contains **entries**, one per day-of-week (Mon–Sun, max 7). Each entry is `(time, category, title, body)`. The system materializes today's matching entries into individual scheduled notifications every morning. The dispatcher then sends them.

#### Endpoints

| Method | Path                                              | Purpose                            |
| ------ | ------------------------------------------------- | ---------------------------------- |
| GET    | `/api/shop-admin/notifications/plans`             | List this shop's plans             |
| POST   | `/api/shop-admin/notifications/plans`             | Create a plan                      |
| PATCH  | `/api/shop-admin/notifications/plans/{id}`        | Rename / pause / change timezone   |
| DELETE | `/api/shop-admin/notifications/plans/{id}`        | Delete plan + entries              |
| GET    | `/api/shop-admin/notifications/plans/{id}/entries`| List entries (sorted by day_of_week)|
| PUT    | `/api/shop-admin/notifications/plans/{id}/entries`| Bulk-replace all entries           |

#### Request/response shapes

**`POST /plans`**
```jsonc
// body
{
  "name": "Weekly menu",
  "timezone": "Europe/Ljubljana"   // optional, defaults to Europe/Ljubljana
  // "is_active": true              // optional
}
// 200
{
  "status": 200,
  "message": "Plan created",
  "data": {
    "id": "uuid",
    "name": "Weekly menu",
    "is_active": true,
    "timezone": "Europe/Ljubljana",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

**`PATCH /plans/{id}`** — body any subset of `{ name, timezone, is_active }`. 404 if the plan doesn't belong to this shop.

**`GET /plans/{id}/entries`**
```jsonc
{
  "status": 200,
  "data": {
    "entries": [
      {
        "id": "uuid",
        "day_of_week": 1,                  // 0=Sun, 1=Mon, ..., 6=Sat
        "send_time_local": "11:30:00",     // HH:MM:SS in the plan's timezone
        "notification_type": "daily_meal",
        "title": "Today's pasta",
        "body": "Tagliatelle with truffle...",
        "data": {},
        "is_active": true
      }
      // 0–7 entries
    ]
  }
}
```

**`PUT /plans/{id}/entries`** — **whole-week save**. The dashboard sends every enabled row in one call; the backend wipes all existing entries and inserts the new set.

```jsonc
// body
{
  "entries": [
    {
      "day_of_week": 1,
      "send_time_local": "11:30",        // HH:MM or HH:MM:SS, both accepted
      "notification_type": "daily_meal", // "manual" | "daily_meal" | "specials"
      "title": "Today's pasta",
      "body": "Tagliatelle with truffle...",
      "data": {},                         // optional
      "is_active": true                   // optional, default true
    }
    // up to 7 entries; one per day_of_week (validated server-side)
  ]
}
// 200
{ "status": 200, "message": "Entries saved", "data": { "count": 1 } }
// 400 if duplicate day_of_week
// 404 if plan not found / not this shop
```

Empty `entries: []` is valid — clears all entries (effectively pauses the plan; `PATCH /plans/{id}` `is_active=false` is the cleaner equivalent).

#### UX

A new section titled **Weekly Plan**:

1. **Plan picker / creator.** Most shops will have one plan. Show a dropdown of this shop's plans; if none exist, show an empty state with a "Create weekly plan" button.

2. **Plan header** (when one is selected):
   - Editable name (PATCH on blur).
   - Active toggle (PATCH on change). Inactive plans are not materialized.
   - Timezone (PATCH; default to `Europe/Ljubljana`, expose as a curated short list of common European zones with an "Other..." escape hatch — full IANA list is overkill).
   - Delete button with a confirm dialog.

3. **Day grid** — the heart of the feature. 7 rows, Mon → Sun (note: backend stores 0=Sun, 1=Mon, ..., 6=Sat — convert in your UI). Each row:
   - Enabled checkbox (entry-level `is_active`; absent row = no entry for that day).
   - Time picker (`send_time_local`, 5-minute steps are plenty).
   - Category dropdown: `manual` / `daily_meal` / `specials`. Default `daily_meal`.
   - Title input (max 100).
   - Body textarea (max 500).
   - **Per-row audience preview chip**: reuses `GET /audience-preview?category={cat}` — show the count for the row's chosen category.

4. **Save button** — single button, calls `PUT /plans/{id}/entries` with the array of *enabled* rows. Show a saved/unsaved indicator so users know there's pending work.

5. **"Next 7 sends" preview list** — computed client-side from the saved plan + today's date in the plan's timezone. For each of the next 7 calendar days that has an enabled entry, render `Mon May 12 11:30 — Today's pasta`. Helps catch DST surprises and "I forgot Tuesday is empty" moments.

6. **Status banners**:
   - If the plan is inactive: yellow banner *"This plan is paused. No notifications will be sent until you re-enable it."*
   - The dry-run banner described above applies here too.
   - If `subscribed_count` for any category is 0, same soft warning (no block).

#### Edge cases

- **Duplicate day_of_week** on save returns 400 with a message naming the duplicate day. Validate client-side too — disable the Save button when violated.
- **Today's entry, after the time has passed.** The materializer skips past-due entries (it doesn't backfill). If the admin saves Monday 11:30 at 12:00, Monday's send happens *next* Monday, not retroactively today. Mention this in a tooltip near the time picker: *"Changes apply from the next occurrence forward."*
- **Multiple categories same day.** Not supported in v1 (UNIQUE constraint on `plan_id, day_of_week`). UI can leave a note: *"Need two pushes on the same day? Create another plan."*
- **Whole-week save semantics.** The `PUT` is destructive — every save replaces the full set. There's no per-row PATCH endpoint. Debounce on the client if you want auto-save on blur (~1s is fine).

#### Integration with the rest of the dashboard

- The single-shot **Send Notification** form is unchanged — coexists with weekly plans.
- Plan-materialized rows show up in the **History** tab exactly like ad-hoc sends. They appear with `dry_run` status until the global delivery flag flips.
- The **Scheduled** queue (see History tab below) shows plan-materialized rows alongside one-off scheduled sends. They look identical from the queue's perspective.

---

### Notifications: Tab 2 — **Birthday Settings**

The existing form stays. Add a **coupon attachment** below the message body, plus a small copy update on the right-side info panel.

#### Endpoint changes

**`POST /api/shop-admin/notifications/birthday-template`** — body adds optional fields:

```jsonc
{
  "title": "Happy birthday!",
  "body": "...",
  "data": {},
  "is_active": true,
  "coupon_id": "uuid-or-null"      // pass null to clear, omit to leave unchanged
}
```

The backend verifies `coupon_id` belongs to this shop (400 otherwise).

**`GET /api/shop-admin/notifications/birthday-template`** — response gains:

```jsonc
{
  "status": 200,
  "data": {
    "id": "uuid",
    "title": "...",
    "body": "...",
    "data": {},
    "is_active": true,
    "coupon_id": "uuid-or-null",
    "coupon": {                     // populated when coupon_id is set, else null
      "id": "uuid",
      "name": "10% birthday discount",
      "type": "percentage",
      "is_birthday_only": true
    }
  }
}
```

#### UX

Below the existing message body field:

1. **Toggle: "Attach a birthday coupon"**
   - Off → POST template with `coupon_id: null`.
   - On → reveal the coupon picker.

2. **Coupon picker** (when toggle is on):
   - Dropdown listing this shop's coupons. Reuse the existing `GET /api/shop-admin/coupons` (the same endpoint the Coupons tab uses).
   - Strongly recommend filtering / sorting `is_birthday_only=true` coupons to the top, with a label like "Birthday-only — recommended."
   - Below the dropdown, a one-liner explanation of the selected coupon: `"10% off any purchase · Birthday-only · expires in N days"`.
   - A small "Create new birthday coupon" link/button that deep-links to the Coupons tab with `is_birthday_only` pre-checked.

3. **Mobile preview update** — when a coupon is attached, append a coupon-style line to the preview, e.g. *"🎁 10% off — tap to view"*.

4. **Soft-warning when the chosen coupon isn't `is_birthday_only`**: birthday-only coupons are hidden from the public list and from the app for non-birthday users. A non-`is_birthday_only` coupon is technically *visible to everyone, every day*, defeating the purpose. Show:

   > *"Tip: this coupon isn't marked Birthday-only. Customers will see it any day, not just their birthday. [Make it birthday-only]"*

   The fix link toggles `is_birthday_only=true` on the coupon (PATCH on the coupons endpoint).

5. **Pro Tips panel update** — add one bullet:

   > *"Tip: attach a birthday coupon for higher engagement. Customers see the coupon only on their birthday and can redeem it once."*

#### Right-side info panel copy update

Replace:

> *Sent automatically once daily at 9:00 AM*
> *Only sent to customers celebrating their birthday that day*

With:

> *Sent automatically once daily at 9:00 AM*
> *Only sent to customers who have **favorited your shop** and have it as their birthday*
> *Customers who haven't favorited the shop won't receive birthday messages*

#### Backend behavior (context, not a UI task)

- Birthday-only coupons (`coupons.is_birthday_only=true`) are hidden from the public coupon list (`/api/public/stores/{id}/coupons`).
- They're invisible in the native app's coupon list **except** to users whose date-of-birth month+day matches today.
- They can be **redeemed once per user, ever** — enforced by `/api/app/coupons/{id}/activate`.
- POS doesn't know any of this — to POS, it's a normal redemption code.

---

### Notifications: Tab 3 — **Analytics**

The existing endpoint returns more fields now:

```
GET /api/shop-admin/notifications/analytics
→ {
    "status": 200,
    "data": {
      "total_sent": 1240,
      "total_delivered": 1180,
      "total_failed": 35,
      "total_dry_run": 25,                // sends recorded but not delivered (kill switch)
      "delivery_rate": 95.2,
      "by_type": {
        "manual": 800,
        "birthday": 200,
        "daily_meal": 240
      },
      "delivery_rate_by_type": {           // per-category delivery percentage
        "manual": 96.0,
        "birthday": 99.5,
        "daily_meal": 92.1
      },
      "subscriber_count": 540,             // total favorites
      "subscriber_count_by_category": {    // opt-in counts per category
        "daily_meal": 412,
        "specials": 480,
        "birthday": 510,
        "manual": 540
      }
    }
  }
```

Add two new sections:

**Subscribers** (new card group, place near top):
- Big number: `subscriber_count` — *"540 customers follow your shop"*
- Small breakdown bars: opt-in count per category, e.g.:
  - Daily meal: 412
  - Specials: 480
  - Birthday: 510
  - Announcements: 540

**Per-category delivery rate** (new card or table):

| Category   | Sent | Delivery rate |
| ---------- | ---- | ------------- |
| Birthday   | 200  | 99.5%         |
| Daily meal | 240  | 92.1%         |
| Manual     | 800  | 96.0%         |

If `total_dry_run > 0`, surface a small notice:

> *{N} notifications were recorded in test mode and not delivered. These are excluded from delivery rate.*

---

### Notifications: Tab 4 — **History**

#### Updated filter dropdown

The `type` filter gains two options:
- `daily_meal` → *Daily meal*
- `specials` → *Special / promo*

The `status` filter gains one option:
- `dry_run` → *Test mode (not delivered)*

Endpoint and response shape unchanged otherwise:

```
GET /api/shop-admin/notifications/history?page=1&limit=50&type=...&status=...
```

In the result list, render `dry_run` rows with a distinct badge color (gray/yellow) and a tooltip: *"Recorded in test mode — backend delivery was disabled at send time."*

#### New: scheduled queue section

Above or alongside the history list, add a section for upcoming scheduled sends (this is where one-off scheduled sends AND plan-materialized sends both surface):

```
GET /api/shop-admin/notifications/scheduled?status=scheduled
→ {
    "status": 200,
    "data": {
      "scheduled": [
        {
          "id": "uuid",
          "notification_type": "daily_meal",
          "title": "Today's pasta",
          "body": "...",
          "scheduled_for": "2026-05-09T11:30:00Z",
          "status": "scheduled",
          "recipient_count": null,
          "sent_at": null,
          "created_at": "2026-05-08T..."
        }
      ]
    }
  }
```

Render each as a row with: time, category badge, title, and a **Cancel** button.

Cancel:

```
DELETE /api/shop-admin/notifications/scheduled/{id}
→ 200 { "status": 200, "message": "Cancelled" }
→ 404 { "status": 404, "message": "Not found or already sent/cancelled" }
```

After a successful cancel, refetch the scheduled list.

You can also fetch sent/cancelled/failed scheduled rows by passing `?status=sent|cancelled|failed`.

---

### Coupons screen — new `is_birthday_only` toggle

In the **Coupons** tab (the existing CRUD screen, not the Notifications screens), the create/edit form gets one new field:

- **Birthday-only checkbox**: maps to `coupons.is_birthday_only`. Default `false`.

Tooltip / helper text:

> *"When enabled, this coupon is hidden from the general coupon list. Only customers celebrating their birthday today will see it in the app, and each customer can redeem it only once."*

Endpoint: the existing `POST /api/shop-admin/coupons` and `PATCH /api/shop-admin/coupons/{id}` accept `is_birthday_only` in the body. No new endpoint.

The Coupons list view should show a small "🎂 Birthday-only" pill on rows where the flag is true so admins can spot them at a glance. Filter / sort by birthday-only on the list is a nice-to-have.

---

## Endpoint summary (backend → dashboard contract)

| Method | Path                                                | Purpose                              | New?     |
| ------ | --------------------------------------------------- | ------------------------------------ | -------- |
| POST   | `/notifications/broadcast`                          | Send now or schedule (with category) | Modified |
| GET    | `/notifications/audience-preview?category={cat}`    | Reach preview                        | New      |
| GET    | `/notifications/quota`                              | Manual broadcast quota               | New      |
| GET    | `/notifications/scheduled?status={status}`          | List scheduled sends                 | New      |
| DELETE | `/notifications/scheduled/{id}`                     | Cancel a scheduled send              | New      |
| GET    | `/notifications/history?type=&status=&page=&limit=` | History (extended filters)           | Modified |
| GET    | `/notifications/analytics`                          | Analytics (extended payload)         | Modified |
| GET    | `/notifications/birthday-template`                  | Read birthday template (+ coupon)    | Modified |
| POST   | `/notifications/birthday-template`                  | Save birthday template (+ coupon_id) | Modified |
| GET    | `/notifications/plans`                              | List weekly plans                    | New      |
| POST   | `/notifications/plans`                              | Create weekly plan                   | New      |
| PATCH  | `/notifications/plans/{id}`                         | Update plan (name/tz/active)         | New      |
| DELETE | `/notifications/plans/{id}`                         | Delete plan + entries                | New      |
| GET    | `/notifications/plans/{id}/entries`                 | List 7-day entries                   | New      |
| PUT    | `/notifications/plans/{id}/entries`                 | Bulk-replace all entries             | New      |
| POST   | `/coupons` *(existing)*                             | Now accepts `is_birthday_only`       | Modified |
| PATCH  | `/coupons/{id}` *(existing)*                        | Now accepts `is_birthday_only`       | Modified |

The full OpenAPI spec is at `GET /api/openapi.json` on the backend and rendered at `/api/docs`. Use it as the source of truth for type generation.

---

## Acceptance checklist

For QA / a quick PR review before shipping:

**Send Notification (single send + schedule):**
- [ ] Category dropdown is required, defaults to `manual`.
- [ ] Audience preview chip updates when category changes.
- [ ] Audience preview shows zero-state copy (no blocking) when `subscribed_count = 0`.
- [ ] Schedule toggle reveals datetime picker; submitting in the past is rejected client-side.
- [ ] Quota indicator only shows for `manual` category and disables Send when exhausted.
- [ ] After a 429, the inline error includes a human-readable retry duration.
- [ ] Dry-run banner appears the first time a response includes `dry_run > 0` and persists for the session.

**Weekly plan:**
- [ ] Empty state when shop has no plans.
- [ ] Create plan, default name + timezone populated.
- [ ] 7-day grid renders Mon–Sun (not Sun–Sat); UI converts day_of_week correctly.
- [ ] Time picker uses the plan's timezone, not the user's browser zone, in copy ("11:30 in Europe/Ljubljana").
- [ ] Per-row audience preview updates when the row's category changes.
- [ ] Save button is disabled when there are duplicate day_of_week values.
- [ ] "Next 7 sends" client-side computation matches what the materializer will produce (spot-check across a Sun/Mon boundary).
- [ ] Plan toggle off → grid disabled, banner shows the plan is paused.
- [ ] Delete plan confirms before destroying entries.
- [ ] After save, History shows the materialized rows on the next morning's run.

**Birthday Settings:**
- [ ] Right-side info panel copy updated.
- [ ] Toggle off → coupon picker hidden, save sends `coupon_id: null`.
- [ ] Toggle on → coupon picker required before save.
- [ ] Saving a coupon from another shop returns 400 (shouldn't be reachable via the dropdown, but guard).
- [ ] Selected coupon's name/type/`is_birthday_only` shows under the picker.
- [ ] Soft-warning appears when the selected coupon is not `is_birthday_only`.
- [ ] Mobile preview renders the coupon line when attached.

**Analytics:**
- [ ] Subscriber counts and per-category delivery rates render.
- [ ] `total_dry_run > 0` shows the test-mode notice.

**History:**
- [ ] Filter dropdowns include the new categories and `dry_run` status.
- [ ] `dry_run` rows are visually distinct.
- [ ] Scheduled queue list renders, and Cancel works (refetch after).

**Coupons tab:**
- [ ] New `is_birthday_only` checkbox saves correctly via existing endpoints.
- [ ] List view shows the 🎂 pill for birthday-only coupons.

---

## What you do **not** need to build

- Per-customer or per-segment targeting in the dashboard. Recipient resolution is by-category only for now.
- A "preview message on a fake device" feature beyond the existing mobile-preview card.
- Anything related to the native app's favorites UI — that's a separate plan.
- Cross-shop digest (bundling notifications from multiple shops into one push). That comes later, on the app side.
- Per-row PATCH for plan entries — `PUT` whole-week save is the only mutation path.

---

## Open questions for the dashboard team

1. **Scheduled queue placement.** Inline in the History tab, or as its own sub-section in Send Notification ("Your scheduled sends")? Recommend Send Notification since admins will want to cancel/edit right after scheduling.
2. **Schedule picker timezone.** Shop's local time or browser local time? Backend stores UTC; whichever you pick, be consistent and label it. Same question for the weekly-plan time picker — answer should match.
3. **Dry-run banner persistence.** Hide if a session never receives a `dry_run > 0` response? Yes — only show after first observed.
4. **One plan or many?** Most shops will have a single weekly plan, but the API supports unlimited. Pick one UX (always show "Plan 1 / Plan 2 / ..." tabs vs. single-plan mode unless multiple exist) and stay consistent.
5. **Plan-vs-manual badging in the queue.** Backend doesn't currently flag plan-materialized rows. Defer until users complain; if needed, easy to add a `source: "plan" | "manual"` column later.
