# Production Setup Guide - Zvest Loyalty Platform

## 🚀 Overview

This guide walks you through setting up the Zvest Loyalty Platform for production use with proper API key management, security, and deployment practices.

## 📋 Prerequisites

- Node.js 18+ or Bun runtime
- Supabase project (production instance)
- Domain name (for production API)
- SSL certificate (automatically handled by most platforms)

## 🔑 Step 1: Generate API Keys

### Option A: Using Our Generation Script

```bash
# Generate API keys for your POS providers
bun run scripts/generate-api-keys.ts --provider "Elektronek POS" --provider "Square POS"

# Or generate multiple at once
bun run scripts/generate-api-keys.ts --count 3
```

This will output:

- Secure API keys
- Environment variable format
- SQL for database setup

### Option B: Manual Generation

Create secure API keys following this pattern:

```
pos-[provider-slug]-[timestamp]-[random]
```

Example: `pos-elektronek-pos-20241217-a1b2c3d4e5f6`

## 🔧 Step 2: Environment Configuration

### Development (.env)

```bash
# Copy the template
cp env.example .env

# Edit with your values
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Development API keys (auto-generated)
DEV_API_KEY_ELEKTRONEK=dev-elektronek-2024-secure-key
DEV_API_KEY_SECONDARY=dev-secondary-2024-secure-key
```

### Production (.env.production)

```bash
# Production environment
SUPABASE_URL=https://your-prod-project.supabase.co
SUPABASE_ANON_KEY=your_prod_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_prod_service_role_key
PORT=3000
NODE_ENV=production
LOG_LEVEL=info

# Production POS providers (from generation script)
POS_PROVIDERS="Elektronek POS:pos-elektronek-20241217-abc123,Square POS:pos-square-20241217-def456"
```

## 🗄️ Step 3: Database Setup

### Run the Schema

1. Open your Supabase SQL Editor
2. Copy and run the content from `database/platform-schema-simple.sql`
3. This creates all tables, indexes, and triggers

### Seed POS Providers

Use the SQL output from the generation script:

```sql
-- Generated from scripts/generate-api-keys.ts
DELETE FROM pos_providers WHERE api_key LIKE 'pos-%';

INSERT INTO pos_providers (name, description, api_key) VALUES
('Elektronek POS', 'POS integration partner', 'pos-elektronek-20241217-abc123'),
('Square POS', 'POS integration partner', 'pos-square-20241217-def456');
```

## 🚀 Step 4: Deployment Options

### Option A: Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway link [your-project-id]

# Set environment variables
railway variables set SUPABASE_URL=https://your-prod-project.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
railway variables set POS_PROVIDERS="Elektronek POS:pos-elektronek-abc123"
railway variables set NODE_ENV=production

# Deploy
railway deploy
```

### Option B: Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Set environment variables
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add POS_PROVIDERS
vercel env add NODE_ENV

# Redeploy with environment
vercel --prod
```

### Option C: Docker

```dockerfile
# Dockerfile
FROM oven/bun:1 as dependencies
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 as build
WORKDIR /app
COPY . .
COPY --from=dependencies /app/node_modules ./node_modules
RUN bun run build

FROM oven/bun:1 as runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "start"]
```

## 🔒 Step 5: Security Configuration

### API Key Security

1. **Never commit API keys** to version control
2. **Rotate keys quarterly** in production
3. **Use different keys** per environment
4. **Monitor key usage** through logs

### Database Security

```sql
-- Enable Row Level Security
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Create policies (example)
CREATE POLICY "Shops are viewable by their POS provider" ON shops
FOR SELECT USING (
    pos_provider_id IN (
        SELECT id FROM pos_providers
        WHERE api_key = current_setting('request.jwt.claims', true)::json->>'api_key'
    )
);
```

### Network Security

1. **Use HTTPS only** in production
2. **Configure CORS** for your domains
3. **Rate limiting** (optional)
4. **IP whitelisting** for POS providers (optional)

## 📊 Step 6: Monitoring & Logging

### Health Checks

```bash
# Test health endpoint
curl https://api.yourdomain.com/health

# Expected response
{
  "status": "healthy",
  "timestamp": "2024-12-17T10:30:00.000Z",
  "version": "2.0.0"
}
```

### API Testing

```bash
# Test POS integration
curl -X GET https://api.yourdomain.com/api/pos/shops \
  -H "x-api-key: pos-elektronek-20241217-abc123"

# Test admin endpoints
curl -X GET https://api.yourdomain.com/api/admin/customers
```

### Logging Setup

Configure structured logging:

```typescript
// config/logger.ts - production config
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
        }
      : undefined,
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});
```

## 🔄 Step 7: Maintenance

### Adding New POS Providers

1. **Generate new API key**:

   ```bash
   bun run scripts/generate-api-keys.ts --provider "New POS Company"
   ```

2. **Update environment**:

   ```bash
   # Add to POS_PROVIDERS
   POS_PROVIDERS="Existing:key1,New POS Company:new-key"
   ```

3. **Update database**:
   ```sql
   INSERT INTO pos_providers (name, description, api_key) VALUES
   ('New POS Company', 'New POS integration', 'new-generated-key');
   ```

### API Key Rotation

1. Generate new keys
2. Update environment variables
3. Update database
4. Notify POS providers
5. Remove old keys after transition period

### Backup Strategy

1. **Database backups** - Supabase handles automatically
2. **Environment backups** - Store securely (password manager)
3. **API key backups** - Keep encrypted copies

## 🧪 Step 8: Testing Production Setup

### Automated Tests

```bash
# Test API key authentication
curl -X GET $API_URL/api/pos/shops \
  -H "x-api-key: $PROD_API_KEY" \
  | jq '.success'

# Should return: true
```

### Integration Tests

1. Create test customer
2. Create test shop
3. Generate transaction
4. Test QR code scanning
5. Verify points awarded

## 📞 Support & Troubleshooting

### Common Issues

1. **Invalid API key**: Check environment variables and database
2. **Database connection**: Verify Supabase credentials
3. **CORS errors**: Configure allowed origins
4. **Rate limiting**: Check provider limits

### Monitoring Checklist

- [ ] Health endpoint responding
- [ ] API keys working
- [ ] Database connectivity
- [ ] Transaction processing
- [ ] QR code generation
- [ ] Points calculation
- [ ] Error rates < 1%
- [ ] Response times < 2s

### Emergency Procedures

1. **API key compromise**: Immediate rotation
2. **Database issues**: Check Supabase status
3. **High error rates**: Check logs and rollback if needed
4. **Performance issues**: Scale horizontally

## 🎯 Production Checklist

- [ ] Generated secure API keys
- [ ] Environment variables configured
- [ ] Database schema deployed
- [ ] POS providers seeded
- [ ] SSL certificate configured
- [ ] Domain pointing to API
- [ ] Health checks passing
- [ ] API documentation accessible
- [ ] Monitoring setup
- [ ] Backup strategy in place
- [ ] Emergency contacts documented

## 📚 Additional Resources

- [API Documentation](https://api.yourdomain.com/api/docs)
- [POS Integration Guide](./POS_INTEGRATION_GUIDE.md)
- [Database Schema](../database/platform-schema-simple.sql)
- [Environment Template](../env.example)

---

## 🔧 Quick Start Commands

```bash
# 1. Generate API keys
bun run scripts/generate-api-keys.ts --count 2

# 2. Set up environment
cp env.example .env
# Edit .env with your values

# 3. Test locally
bun run dev

# 4. Deploy to production
# Follow deployment option above

# 5. Test production
curl https://api.yourdomain.com/health
```

**Need help?** Contact: support@zvest.com
