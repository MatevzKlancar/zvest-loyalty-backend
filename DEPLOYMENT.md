# Deployment Guide

This guide covers deploying the Zvest POS Integration Backend to production.

## Prerequisites

1. **Supabase Project**: Create a new project at [supabase.com](https://supabase.com)
2. **Domain**: A domain for your API (e.g., `zvest-loyalty-backend.onrender.com`)
3. **SSL Certificate**: Ensure HTTPS is configured

## Database Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the database to be provisioned
3. Note down your project URL and keys

### 2. Run Database Schema

1. Open the Supabase SQL Editor
2. Copy and paste the contents of `database/schema.sql`
3. Run the script to create all tables, indexes, and sample data

### 3. Configure Row Level Security (Optional)

```sql
-- Enable RLS on sensitive tables
ALTER TABLE pos_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

-- Add policies as needed for your security requirements
```

## Environment Configuration

### Production Environment Variables

```env
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Server Configuration
PORT=3000
NODE_ENV=production

# Logging
LOG_LEVEL=info
```

## Deployment Options

### Option 1: Railway (Recommended)

1. **Connect Repository**:

   ```bash
   # Install Railway CLI
   npm install -g @railway/cli

   # Login and create project
   railway login
   railway init
   ```

2. **Configure Environment**:

   - Add environment variables in Railway dashboard
   - Set `RAILWAY_HEALTHCHECK_TIMEOUT_SEC=300`

3. **Deploy**:
   ```bash
   railway up
   ```

### Option 2: Vercel

1. **Install Vercel CLI**:

   ```bash
   npm install -g vercel
   ```

2. **Configure for Bun**:
   Create `vercel.json`:

   ```json
   {
     "builds": [
       {
         "src": "src/index.ts",
         "use": "@vercel/bun"
       }
     ],
     "routes": [
       {
         "src": "/(.*)",
         "dest": "src/index.ts"
       }
     ]
   }
   ```

3. **Deploy**:
   ```bash
   vercel --prod
   ```

### Option 3: Docker + Cloud Run

1. **Create Dockerfile**:

   ```dockerfile
   FROM oven/bun:1 as base
   WORKDIR /app

   COPY package.json bun.lockb ./
   RUN bun install --frozen-lockfile

   COPY . .

   EXPOSE 3000
   ENV NODE_ENV=production

   CMD ["bun", "run", "start"]
   ```

2. **Build and Deploy**:

   ```bash
   # Build image
   docker build -t zvest-backend .

   # Deploy to Google Cloud Run
   gcloud run deploy zvest-backend \
     --image gcr.io/PROJECT-ID/zvest-backend \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated
   ```

### Option 4: VPS/Dedicated Server

1. **Install Dependencies**:

   ```bash
   # Install Node.js and Bun
   curl -fsSL https://bun.sh/install | bash

   # Install PM2 for process management
   npm install -g pm2
   ```

2. **Deploy Application**:

   ```bash
   # Clone repository
   git clone https://github.com/your-org/zvest-backend-pos.git
   cd zvest-backend-pos

   # Install dependencies
   bun install

   # Build (if needed)
   bun run build

   # Start with PM2
   pm2 start ecosystem.config.js
   ```

3. **Configure Nginx** (if using reverse proxy):

   ```nginx
   server {
       listen 80;
       server_name zvest-loyalty-backend.onrender.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

## Post-Deployment Configuration

### 1. Create POS Provider API Keys

Connect to your Supabase database and create API keys for your POS providers:

```sql
INSERT INTO pos_providers (name, description, api_key) VALUES
('Elektronček POS', 'Primary POS integration partner', 'prod-api-key-elektronček-pos-2024'),
('Secondary POS', 'Secondary POS provider', 'prod-api-key-secondary-pos-2024');
```

### 2. Test API Endpoints

```bash
# Health check
curl https://zvest-loyalty-backend.onrender.com/health

# Test POS integration
curl -X GET https://zvest-loyalty-backend.onrender.com/api/pos/shops \
  -H "x-api-key: your-production-api-key"
```

### 3. Monitor Logs

Set up log monitoring based on your deployment platform:

- **Railway**: Use Railway's built-in logging
- **Vercel**: Use Vercel Functions logs
- **Docker**: Use Docker logging drivers
- **PM2**: Use `pm2 logs` or integrate with external logging service

## Security Considerations

### 1. API Key Management

- Generate strong, unique API keys for each POS provider
- Rotate API keys regularly
- Store keys securely and never commit them to version control

### 2. Database Security

- Enable Row Level Security (RLS) in Supabase
- Use least-privilege access for service role keys
- Regular security audits

### 3. Network Security

- Always use HTTPS in production
- Configure CORS properly for your frontend domains
- Consider rate limiting for API endpoints

### 4. Monitoring & Alerting

- Set up health checks and uptime monitoring
- Configure alerts for error rates and response times
- Monitor database performance and query efficiency

## Scaling Considerations

### Database

- Monitor connection pool usage
- Consider read replicas for heavy read workloads
- Optimize queries and add indexes as needed

### Application

- Use horizontal scaling (multiple instances)
- Consider caching for frequently accessed data
- Monitor memory and CPU usage

### API Rate Limiting

```typescript
// Add to your Hono app
import { rateLimiter } from "hono-rate-limiter";

app.use(
  "/api/*",
  rateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
  })
);
```

## Backup Strategy

### Database Backups

Supabase provides automatic backups, but consider:

- Daily automated backups
- Point-in-time recovery testing
- Cross-region backup replication

### Application Backups

- Regular code repository backups
- Environment configuration backups
- API key and secrets backup (encrypted)

## Support & Maintenance

### Regular Updates

- Keep dependencies updated
- Monitor security advisories
- Regular performance optimization

### Monitoring Checklist

- [ ] API response times < 200ms
- [ ] Error rate < 1%
- [ ] Database connection pool healthy
- [ ] SSL certificate valid
- [ ] Backup strategy tested
- [ ] Security scan completed

## Troubleshooting

### Common Issues

1. **Database Connection Issues**:

   - Check Supabase service status
   - Verify connection strings and keys
   - Check connection pool limits

2. **API Key Authentication Failures**:

   - Verify API key format in headers
   - Check POS provider exists in database
   - Validate API key in database

3. **High Response Times**:
   - Check database query performance
   - Monitor application logs
   - Consider adding indexes

For additional support, check the logs and monitoring dashboards for your deployment platform.
