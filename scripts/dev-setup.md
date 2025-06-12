# Development Setup

Quick guide to get the Zvest POS Integration Backend running locally.

## Prerequisites

- [Bun](https://bun.sh) installed
- [Supabase](https://supabase.com) project created
- Code editor (VS Code recommended)

## Setup Steps

### 1. Clone and Install

```bash
git clone <repository-url>
cd zvest-backend-pos
bun install
```

### 2. Environment Configuration

```bash
# Copy environment template
cp env.example .env

# Edit .env with your Supabase credentials
# Get these from your Supabase project settings
```

Required environment variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

### 3. Database Setup

1. Open your Supabase project
2. Go to SQL Editor
3. Copy and paste the content from `database/schema.sql`
4. Run the script

This will create:

- All required tables with proper relationships
- Indexes for performance
- Sample data for testing
- A test POS provider with API key: `test-api-key-elektronček-pos-2024`

### 4. Start Development Server

```bash
bun run dev
```

The server will start on `http://localhost:3000` with hot reload enabled.

### 5. Verify Setup

Open your browser and visit:

- `http://localhost:3000/health` - Health check
- `http://localhost:3000/docs` - API documentation

## Testing the API

### Using the HTTP Examples

The `tests/api-examples.http` file contains ready-to-use HTTP requests. If you use VS Code:

1. Install the "REST Client" extension
2. Open `tests/api-examples.http`
3. Click "Send Request" above any request

### Replace Placeholder Values

After running the database schema, get the actual UUIDs:

1. Go to your Supabase project → Table Editor
2. Open the `shops` table
3. Copy the UUID of the test shop
4. Replace `SHOP_UUID_HERE` in the HTTP examples

### Test Flow Example

1. **Get shops**: `GET /api/pos/shops`
2. **Create transaction**: `POST /api/pos/transactions`
3. **Scan QR code**: `POST /api/customers/scan`

## Development Tools

### VS Code Extensions (Recommended)

- REST Client - For testing API endpoints
- Bun for Visual Studio Code - Bun support
- TypeScript Importer - Auto imports

### Database Management

- Use Supabase Table Editor for visual database management
- Use Supabase SQL Editor for running queries

## Common Development Tasks

### Adding New Endpoints

1. Create validation schema in `src/schemas/`
2. Add business logic to appropriate service in `src/services/`
3. Create route handler in `src/routes/`
4. Add OpenAPI documentation comments
5. Test using HTTP examples

### Database Changes

1. Make changes in Supabase SQL Editor
2. Update TypeScript types in `src/types/database.ts`
3. Update validation schemas if needed

### Debugging

- Check terminal output for detailed logs
- Use browser dev tools for API documentation
- Check Supabase logs for database errors

## Project Structure

```
src/
├── config/          # Environment and database configuration
├── middleware/      # Authentication and error handling
├── routes/          # API route definitions
├── schemas/         # Zod validation schemas
├── services/        # Business logic layer
├── types/           # TypeScript type definitions
└── index.ts         # Application entry point

database/
└── schema.sql       # Database schema and sample data

tests/
└── api-examples.http # HTTP request examples
```

## Next Steps

1. Familiarize yourself with the API documentation at `/docs`
2. Test all endpoints using the provided HTTP examples
3. Customize the business logic for your specific requirements
4. Add additional validation or features as needed

## Troubleshooting

### Common Issues

**"Cannot find module" errors**: Run `bun install` again

**Database connection errors**:

- Check your `.env` file
- Verify Supabase credentials
- Ensure your IP is allowed in Supabase settings

**API key authentication fails**:

- Use the test API key: `test-api-key-elektronček-pos-2024`
- Check the `pos_providers` table in Supabase

**TypeScript errors**:

- The project uses Bun's built-in TypeScript support
- Some dependencies may show type errors but won't affect functionality

Need help? Check the logs, verify your environment variables, and ensure your Supabase project is properly configured.
