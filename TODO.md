# Zvest Backend - TODO

## Reservation System

### Completed ✅
- [x] Database schema for reservation system (migration applied)
- [x] Database trigger for auto-creating reminders
- [x] Edge Function `process-reservation-reminders` with Resend integration
- [x] Quiet hours support (22:00-05:00 CET)
- [x] Clean module structure created at `src/modules/reservations/`
- [x] Constants, types, and schemas (`reservation.constants.ts`, `reservation.types.ts`, `reservation.schemas.ts`)
- [x] Utility functions (`utils/time-slots.ts`)
- [x] Services created:
  - `services/reservation.service.ts` - Core reservation logic (create, update, cancel, confirm, no-show)
  - `services/availability.service.ts` - Slot availability & schedule management
  - `services/resource.service.ts` - Services & resources (staff/tables) management
- [x] Routes created:
  - `routes/shop-admin.routes.ts` - Shop owner endpoints (all CRUD operations)
  - `routes/public.routes.ts` - Guest booking & availability checking
  - `routes/app-user.routes.ts` - Authenticated app user endpoints

### All Core Tasks Completed ✅

- [x] Integrated reservation module into `src/index.ts`
- [x] Added `increment_no_show_count` SQL function via migration
- [x] Fixed TypeScript type warnings with proper Hono context types
- [x] Server starts successfully with all 32 reservation endpoints registered

### Ready for Testing 🧪

Test these key flows:
1. Shop admin creates a service
2. Shop admin creates a resource (staff member)
3. Shop admin sets availability schedule
4. Guest/app user checks availability
5. Guest/app user creates a reservation
6. Shop admin confirms/cancels/completes reservation
7. No-show marking and user blocking

**API Documentation:** `http://localhost:3000/api/docs`

### Pending (Not Started)
- [ ] Set up pg_cron for reminder processing (see instructions below)
- [ ] SMS notifications (when SMS provider is chosen)
- [ ] Reservation analytics for shop dashboard

---

## Module Structure Reference

```
src/modules/reservations/
├── index.ts                      # Module barrel export
├── reservation.constants.ts      # Status, types, defaults
├── reservation.types.ts          # TypeScript interfaces
├── reservation.schemas.ts        # Zod validation schemas
├── services/
│   ├── index.ts                  # Services barrel export
│   ├── reservation.service.ts    # Core reservation CRUD
│   ├── availability.service.ts   # Slots & schedules
│   └── resource.service.ts       # Staff/tables/services
├── routes/
│   ├── index.ts                  # Routes barrel export
│   ├── shop-admin.routes.ts      # Shop owner endpoints
│   ├── public.routes.ts          # Guest/public endpoints
│   └── app-user.routes.ts        # Authenticated user endpoints
└── utils/
    └── time-slots.ts             # Time manipulation helpers
```

---

## pg_cron Setup for Reservation Reminders

The `process-reservation-reminders` Edge Function needs to run every 5 minutes to send reminder notifications.

### Prerequisites
1. Supabase project: `ftkbnhykzolazrrmucpw`
2. Edge Function deployed: `process-reservation-reminders`
3. `RESEND_API_KEY` set in Supabase Edge Function secrets

### Step 1: Enable Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```

### Step 2: Store Service Role Key

Go to **Supabase Dashboard > Settings > API** and copy the `service_role` key, then run:

```sql
ALTER DATABASE postgres SET "app.settings.service_role_key" = 'your-service-role-key-here';
```

### Step 3: Create Cron Job

```sql
SELECT cron.schedule(
  'process-reservation-reminders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ftkbnhykzolazrrmucpw.supabase.co/functions/v1/process-reservation-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### Step 4: Verify

```sql
SELECT * FROM cron.job;
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

### Managing the Job

```sql
-- Pause
SELECT cron.unschedule('process-reservation-reminders');

-- Resume (run Step 3 again)
```

### Alternative: External Cron

If pg_cron doesn't work, use **cron-job.org** (free):
- URL: `https://ftkbnhykzolazrrmucpw.supabase.co/functions/v1/process-reservation-reminders`
- Method: POST
- Header: `Authorization: Bearer <your-anon-key>`
- Schedule: Every 5 minutes

### Testing

```bash
curl -X POST \
  'https://ftkbnhykzolazrrmucpw.supabase.co/functions/v1/process-reservation-reminders' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json'
```

---

## Future Features

### Email Service Improvements
- [ ] Migrate `src/services/email.ts` to use Resend
- [ ] Add email templates for different notification types

### Reservation Enhancements
- [ ] Recurring reservations support
- [ ] Waitlist functionality
- [ ] Online payment integration for reservations
- [ ] Calendar sync (Google Calendar, iCal)

### General
- [ ] Refactor existing modules to match new clean structure (after reservation module is stable)
