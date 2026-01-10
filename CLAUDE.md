# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Essential Commands
- `bun run dev` - Start development server with hot reload
- `bun run start` - Start production server
- `bun run build` - Build the application
- `bun test` - Run tests
- `bun install` - Install dependencies

### Database Commands
- `bun run db:generate` - Generate TypeScript types from local Supabase database
- `bun run db:generate-platform` - Generate TypeScript types from platform database (requires PROJECT_ID)

### API Key Management
- `bun run scripts/generate-api-keys.ts` - Generate API keys for POS providers

### Google Places Import
- `bun run scripts/bulk-import-slovenia.ts` - Bulk import stores from Google Places for all Slovenian cities
- See `docs/GOOGLE_PLACES_IMPORT.md` for detailed guide on importing/managing stores via Google Places API and Supabase MCP

## Architecture Overview

### Tech Stack
- **Runtime**: Bun.js - Fast JavaScript runtime
- **Framework**: Hono with OpenAPI integration (@hono/zod-openapi)
- **Database**: Supabase (PostgreSQL with real-time capabilities)  
- **Validation**: Zod schemas with OpenAPI auto-generation
- **Logging**: Pino high-performance JSON logger
- **Authentication**: Supabase Auth with JWT tokens + API keys for POS integration

### Application Structure

```
src/
├── config/          # Database connections, logger, environment config
├── middleware/      # Authentication, error handling, unified auth
├── routes/          # API route definitions organized by user type
├── services/        # Business logic layer (email, image upload)
├── utils/           # Utility functions (localization, redemption codes)
└── types/           # TypeScript type definitions from Supabase

database/            # SQL schema and migration files
tests/              # HTTP test examples
scripts/            # Development utilities
```

### Route Organization
Routes are organized by user type and access level:

- `/api/admin` - Platform administration (requires admin JWT)
- `/api/shop-admin` - Shop owner business dashboard (requires shop owner JWT)
- `/api/shop` - Shop-specific endpoints (requires shop owner JWT)
- `/api/app-user` - B2C app user endpoints (public access)
- `/api/public` - Public store APIs (no authentication)
- `/api/pos` - POS system integration (requires API key)
- `/api/app` - Customer mobile app endpoints (public access)

### Authentication Strategy
The application uses a multi-tiered authentication approach:

1. **JWT Authentication**: Admin and shop owner endpoints use Supabase Auth tokens
2. **API Key Authentication**: POS integration endpoints use `x-api-key` header
3. **Public Access**: Customer-facing and setup endpoints require no authentication
4. **Role-Based Access**: Same endpoints return different data based on user role

### Multi-Tenancy Architecture
The system supports both platform customers (shared database) and enterprise customers (dedicated databases):

- `DatabaseConnectionManager` handles connection routing
- `getDatabaseForShop()` automatically routes to correct database
- Enterprise customers get dedicated Supabase instances
- Platform customers share the main database

### Error Handling Philosophy
POS integration uses business-logic-friendly error handling:

- **Business Logic Errors** → HTTP 200 with `{ valid: false, error_code, error_message }`
- **Technical Errors** → Standard HTTP 4xx/5xx status codes
- This simplifies POS integration by eliminating complex error handling for business rules

## Key Business Logic

### Shop Management Flow
1. Admin creates B2B customer via `/api/admin/onboard-simple`
2. System sends invitation email with secure token
3. Shop owner completes setup via `/api/admin/complete-shop-setup`
4. Shop becomes active and can process transactions

### Loyalty Program Types
- **Points Programs**: Earn X points per euro spent
- **Stamp Programs**: Collect X stamps, get reward free

### Transaction Flow
1. POS saves transaction via `/api/pos/transactions`
2. Customer scans QR code (contains shop_id + invoice_id)
3. Customer redeems points via `/api/app/scan`
4. Loyalty points/stamps automatically calculated

## Critical: Feature Flags & Protected Columns

### DO NOT BREAK: Shop Feature Flags
The `shops` table has feature flag columns that gate access to premium features. Breaking these will lock customers out of paid functionality.

**Protected columns in `shops` table:**
| Column | Purpose | Used By |
|--------|---------|---------|
| `external_qr_codes_enabled` | Gates Article QR Codes feature | `src/routes/shop-admin/article-qr-codes.controller.ts` |
| `reservations_enabled` | Gates Reservation System feature | Reservation routes |
| `feature_tags` (JSONB array) | New feature flag system | Future feature gating |
| `custom_slug` | Custom URL slug for friendly shop URLs | `src/routes/public.ts` |
| `is_automated` | Marks Google Maps imported shops | `src/routes/public.ts`, `src/routes/admin.ts` |
| `automated_source` | Tracks import source (google_maps, manual) | `src/routes/admin.ts` |
| `external_place_id` | Google Place ID for duplicate detection | `src/routes/admin.ts` |
| `rating` | Google Places rating (1.0-5.0) | `src/routes/public.ts` |
| `rating_count` | Number of Google reviews | `src/routes/public.ts` |
| `price_level` | Price level 1-4 (€ to €€€€) | `src/routes/public.ts` |
| `google_maps_url` | Direct link to Google Maps | `src/routes/public.ts` |

**Rules when modifying `shops` table:**
1. NEVER remove or rename these columns without migration plan
2. NEVER change default values (they default to `false` for safety)
3. NEVER add NOT NULL constraints to feature flag columns
4. When adding new features, follow the pattern: add boolean column with `DEFAULT false`
5. The `feature_tags` JSONB array is the future standard - new features should use this

**Migration path:**
- `external_qr_codes_enabled` is being migrated to `feature_tags: ["external-qr-codes"]`
- Keep boolean columns for backward compatibility until all code is updated
- See `database/migrations/add_feature_tags_system.sql` for the pattern

**Related tables that depend on feature flags:**
- `article_qr_codes` - requires `external_qr_codes_enabled = true`
- `reservation_*` tables - require `reservations_enabled = true`

**Shop status values:**
- `pending` - Awaiting setup completion
- `pending_setup` - Setup in progress
- `active` - Real partner shop, fully operational
- `suspended` - Temporarily disabled
- `inactive` - Permanently disabled
- `automated` - Google Maps import, not a real partner (view-only, no loyalty/coupons)

## Development Guidelines

### Environment Setup
1. Copy `.env.example` to `.env` and configure Supabase credentials
2. Run database schema using `database/schema.sql` in Supabase SQL editor
3. Generate API keys using the script in `scripts/`

### Testing
- Use `tests/api-examples.http` with REST Client extension in VS Code
- All POS endpoints return structured responses for easy testing
- Health check available at `/health`

### API Documentation
- Interactive docs at `/api/docs` (Scalar UI)
- OpenAPI spec at `/api/openapi.json`
- Documentation is auto-generated from Zod schemas

### Code Patterns
- All routes use Zod validation with OpenAPI integration
- Database queries use the connection manager for multi-tenancy
- Structured logging with Pino for production debugging
- Error responses include `error_source` field for troubleshooting

### Security Considerations
- Never expose service role keys in client-side code
- API keys are unique per POS provider (not per shop)
- All sensitive operations require proper authentication
- Role-based access ensures data isolation

## Important Files to Understand

### Core Architecture
- `src/index.ts` - Main application setup and route mounting
- `src/config/database.ts` - Multi-tenant database connection management
- `src/middleware/unified-auth.ts` - Authentication middleware for different user types

### Route Examples
- `src/routes/admin.ts` - B2B customer onboarding and management
- `src/routes/pos.ts` - POS integration with business-friendly error handling
- `src/routes/shop-admin.ts` - Shop owner business dashboard

### Type Definitions
- `src/types/database.ts` - Auto-generated from Supabase schema
- Contains all table schemas and relationships

When making changes, always consider the multi-tenant architecture and ensure proper database routing based on customer type.