# Dashboard — Push Notifications Tab Update

This plan is for the **shop-admin dashboard frontend team**. The backend changes are already shipped. Your job is to extend the existing 4-tab Push Notifications screen (Analytics / Send Notification / Birthday Settings / History) to use the new APIs. No new tabs.

The big shift: notifications no longer go to "every customer with a loyalty account." They go to customers who have **favorited the shop** in the native app and **opted in for the chosen category**. Until the native app ships favorites, every audience count will be **0**. That's expected — the dashboard exists to be ready for that flow.

A global delivery kill switch (`PUSH_NOTIFICATIONS_DELIVERY_ENABLED`) is currently `false` on the backend, so any send produces a `dry_run` row instead of a real push. You should make this visible in the UI so admins aren't confused when their inbox is empty.

---

## Auth & response shape (unchanged)

- All endpoints below require `Authorization: Bearer <shop-owner-JWT>` (same as today's broadcast endpoint).
- Response envelope: `{ status: number, message: string, data?: any, error_source?: string }`.
- 4xx and 5xx use the same envelope; check `status` field, not just HTTP code.
- Base path: `/api/shop-admin/notifications/...`

---

## What changes per tab

### Tab 1 — **Send Notification**

The current form (Title + Message + Send button) gains:
- A **category** dropdown (required).
- A **schedule** toggle: "Send now" vs "Schedule for later".
- An **audience preview chip** ("This will reach N of your M favorited customers").
- A **quota indicator** ("1 of 2 manual broadcasts used today").
- A **dry-run banner** when delivery is disabled globally.

#### New: category dropdown

Required field. Three options for now:

| Value         | Label             | When to use                                        |
| ------------- | ----------------- | -------------------------------------------------- |
| `manual`      | Announcement      | One-off messages. Rate-limited (1/hour, 2/day).    |
| `daily_meal`  | Daily meal        | Recurring menu-of-the-day pushes.                  |
| `specials`    | Special / promo   | Limited-time offers, new items, events.            |

Place the dropdown **above** the title field. Default to `manual`.

> Why categories: in the future, the native app will let users opt out of `daily_meal` while keeping `specials` on. So the same shop's pushes can land for the right people only.

#### New: audience preview

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

#### New: schedule toggle

Two-state control: **Send now** (default) | **Schedule**.

When **Schedule** is selected, show a datetime picker. Pass the chosen time as ISO 8601 with timezone (`new Date(...).toISOString()`) in the body field `scheduled_for`. Validate locally that it's in the future before submitting; the backend also enforces this.

#### New: quota indicator

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

Refresh the quota after every successful send. Don't show the quota indicator for `daily_meal` or `specials` — those don't have a rate limit (yet).

#### Updated: send/schedule submit

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

#### New: dry-run banner

Above the whole Send Notification tab, show a persistent banner whenever the most recent send response has `dry_run > 0`. Once you see one of those responses, store a flag in component state and keep the banner visible for the session. Copy:

> **Test mode active.** Push delivery is currently disabled on the backend. Notifications are recorded in History but no devices receive them. Contact engineering to enable delivery.

This avoids the support thread of "I sent a message and nothing happened."

---

### Tab 2 — **Birthday Settings**

**No layout changes.** The existing form stays. Only copy update on the right-side info panel:

Replace:

> *Sent automatically once daily at 9:00 AM*
> *Only sent to customers celebrating their birthday that day*

With:

> *Sent automatically once daily at 9:00 AM*
> *Only sent to customers who have **favorited your shop** and have it as their birthday*
> *Customers who haven't favorited the shop won't receive birthday messages*

Endpoint stays the same: `GET/POST /api/shop-admin/notifications/birthday-template`.

---

### Tab 3 — **Analytics**

The existing endpoint returns more fields now:

```
GET /api/shop-admin/notifications/analytics
→ {
    "status": 200,
    "data": {
      "total_sent": 1240,
      "total_delivered": 1180,
      "total_failed": 35,
      "total_dry_run": 25,                // NEW — sends recorded but not delivered (kill switch)
      "delivery_rate": 95.2,
      "by_type": {
        "manual": 800,
        "birthday": 200,
        "daily_meal": 240
      },
      "delivery_rate_by_type": {           // NEW — per-category delivery percentage
        "manual": 96.0,
        "birthday": 99.5,
        "daily_meal": 92.1
      },
      "subscriber_count": 540,             // NEW — total favorites
      "subscriber_count_by_category": {    // NEW — opt-in counts per category
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

### Tab 4 — **History**

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

#### New: scheduled queue section (optional, recommended)

Above or alongside the history list, add a section for upcoming scheduled sends:

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

You can also fetch sent/cancelled/failed scheduled rows by passing `?status=sent|cancelled|failed` — useful if you want a tab-within-a-tab showing scheduled history. Not required for v1.

---

## Endpoint summary (backend → dashboard contract)

| Method | Path                                                | Purpose                            | New?     |
| ------ | --------------------------------------------------- | ---------------------------------- | -------- |
| POST   | `/notifications/broadcast`                          | Send now or schedule (with category) | Modified |
| GET    | `/notifications/audience-preview?category={cat}`    | Reach preview                      | New      |
| GET    | `/notifications/quota`                              | Manual broadcast quota             | New      |
| GET    | `/notifications/scheduled?status={status}`          | List scheduled sends               | New      |
| DELETE | `/notifications/scheduled/{id}`                     | Cancel a scheduled send            | New      |
| GET    | `/notifications/history?type=&status=&page=&limit=` | History (extended filters)         | Modified |
| GET    | `/notifications/analytics`                          | Analytics (extended payload)       | Modified |
| GET    | `/notifications/birthday-template`                  | Read birthday template             | Unchanged |
| POST   | `/notifications/birthday-template`                  | Save birthday template             | Unchanged |

The full OpenAPI spec is at `GET /api/openapi.json` on the backend and rendered at `/api/docs`. Use it as the source of truth for type generation.

---

## Acceptance checklist

For QA / a quick PR review before shipping:

- [ ] Send Notification: category dropdown is required, defaults to `manual`.
- [ ] Audience preview chip updates when category changes.
- [ ] Audience preview shows zero-state copy (no blocking) when `subscribed_count = 0`.
- [ ] Schedule toggle reveals datetime picker; submitting in the past is rejected client-side.
- [ ] Quota indicator only shows for `manual` category and disables Send when exhausted.
- [ ] After a 429, the inline error includes a human-readable retry duration.
- [ ] Dry-run banner appears the first time a response includes `dry_run > 0` and persists for the session.
- [ ] Birthday Settings copy updated (no logic change).
- [ ] Analytics shows new subscriber counts and per-category delivery rates.
- [ ] History filter dropdowns include the new categories and `dry_run` status.
- [ ] `dry_run` rows in history are visually distinct.
- [ ] Scheduled queue list renders, and Cancel works (refetch after).

---

## What you do **not** need to build (yet)

- Per-customer or per-segment targeting in the dashboard. Recipient resolution is by-category only for now.
- A "preview message on a fake device" feature. The existing mobile-preview card on the right is fine as-is.
- Anything related to the native app's favorites UI — that's a separate plan.
- Cross-shop digest (bundling notifications from multiple shops into one push). That comes later, on the app side.

---

## Open questions for the dashboard team

1. Do you want the scheduled queue inline in the History tab, or as its own sub-section in Send Notification ("Your scheduled sends")? Either is fine — recommend Send Notification since admins will want to cancel/edit right after scheduling.
2. Timezone for the schedule picker: shop's local time or browser local time? Backend stores UTC; whichever you pick, be consistent and label it.
3. Should we hide the dry-run banner if a session never receives a `dry_run > 0` response? Yes — only show it after first observed.
