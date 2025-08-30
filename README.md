# Zvest Loyalty Platform Backend

A modern backend for loyalty platform that allows small businesses to have cost-effective loyalty apps with POS system integration.

## 🏗️ Tech Stack

- **Runtime**: Bun.js (Fast JavaScript runtime)
- **Framework**: Hono (Lightweight web framework)
- **Database**: Supabase (PostgreSQL with real-time capabilities)
- **Documentation**: OpenAPI 3.0 with Scalar UI
- **Validation**: Zod schemas with OpenAPI integration
- **Logging**: Pino (High-performance JSON logger)

## 🎯 Project Overview

### Business Model

This platform enables small businesses to offer loyalty programs to their customers through a partnership model with POS providers. The system provides:

- **For Businesses**: Easy-to-use loyalty programs (points/stamps) with customer engagement
- **For POS Providers**: Additional revenue stream through partnership with loyalty services
- **For Customers**: Unified loyalty experience across participating businesses

### Architecture Philosophy

**Shop Management Flow:**

1. **Zvest Admin Registration**: Shops are pre-registered by Zvest admin team for business validation, contract management, and billing control
2. **POS System Sync**: Once a shop is approved, POS providers sync their shop data with the pre-registered Zvest shop
3. **Active Status Verification**: All operations require shops to be in 'active' status, ensuring only validated businesses participate

This approach ensures:

- ✅ Business validation and KYC compliance
- ✅ Proper contract and billing management
- ✅ Security control over platform access
- ✅ Clear separation between business approval and technical integration

## 🚀 Features

### Core Functionality

#### POS Integration API

- **Shop Management**: Sync POS shop data with pre-approved Zvest shops
- **Menu Synchronization**: Update shop articles/menu from POS system
- **Transaction Processing**: Save purchases for loyalty point calculation
- **Coupon Management**: Validate and redeem promotional coupons

#### Customer Experience

- **QR Code Scanning**: Customers scan receipt QR codes to earn loyalty rewards
- **Automatic Loyalty**: Points/stamps awarded based on shop's loyalty program configuration
- **Unified Platform**: Same experience across all participating shops

#### Business Intelligence

- **Transaction Tracking**: Complete purchase history and analytics
- **Loyalty Program Management**: Flexible points or stamp-based programs
- **Customer Engagement**: Coupon distribution and usage analytics

### Security & Reliability

- API key authentication per POS provider
- Comprehensive input validation with Zod schemas
- Structured error handling with error source tracking
- Performance monitoring with Pino logging
- Database constraints and indexes for data integrity

## 📋 API Endpoints

### POS Provider Endpoints

**⚠️ Important: POS endpoints return POS article IDs, not internal UUIDs**

```
GET    /api/pos/shops                    # Get active shops for POS provider
POST   /api/pos/shops/sync               # Sync shop with POS system data
GET    /api/pos/shops/{id}/coupons       # Get active coupons for shop (returns POS article IDs)
POST   /api/pos/shops/{id}/articles      # Update shop menu/articles
POST   /api/pos/transactions             # Save transaction for loyalty processing
POST   /api/pos/coupons/validate         # Validate and use customer coupons (returns POS article IDs)
```

**Article ID Mapping:**
- POS systems send their article IDs (e.g., "2493", "coffee-latte") 
- System stores both internal UUIDs and POS article IDs
- All POS endpoints automatically return POS article IDs for seamless integration

### Customer App Endpoints

```
POST   /api/customers/scan               # Scan QR code to award loyalty points/stamps
```

### System Endpoints

```
GET    /health                          # Health check
GET    /docs                           # Interactive API documentation
GET    /api-spec                       # OpenAPI specification
```

## 🗄️ Database Schema

### Core Tables

#### `pos_providers`

POS system providers with API authentication

- Stores provider details and API keys
- One provider can serve multiple shops

#### `shops`

Individual business locations with approval workflow

- **Status Management**: `pending` | `active` | `suspended`
- **Approval Tracking**: Admin approval with timestamps
- **POS Sync Data**: Last sync timestamp and POS-specific data
- **Business Validation**: Pre-registration by Zvest admin ensures compliance

#### `loyalty_programs`

Flexible loyalty program configurations per shop

- **Points Programs**: Earn X points per euro spent
- **Stamp Programs**: Collect X stamps, get Y reward free

#### `transactions`

Complete purchase records for loyalty calculation

- Linked to shops with POS invoice IDs
- Items breakdown for detailed analytics
- Loyalty points/stamps tracking

## 🔧 Development Setup

### Prerequisites

- [Bun](https://bun.sh/) installed
- [Supabase](https://supabase.com/) project setup
- Environment variables configured

### Installation

1. **Clone and install dependencies**

   ```bash
   git clone <repository-url>
   cd zvest-backend-pos
   bun install
   ```

2. **Environment Configuration**

   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

3. **Database Setup**

   ```bash
   # Run the schema script in your Supabase SQL editor
   # File: database/schema.sql
   ```

4. **Start Development Server**
   ```bash
   bun run dev
   ```

### Project Structure

```
src/
├── config/          # Database and logger configuration
├── middleware/      # Authentication and error handling
├── routes/          # API route definitions
├── services/        # Business logic layer
├── schemas/         # Zod validation schemas
└── types/           # TypeScript type definitions

database/
└── schema.sql       # Complete database schema

tests/
└── api-examples.http # HTTP test collection
```

## 📖 API Documentation

### Interactive Documentation

Visit `/docs` for Scalar UI with interactive API testing

### OpenAPI Specification

- Full OpenAPI 3.0 specification available at `/api-spec`
- Integrated with route definitions using Hono OpenAPI
- Auto-generated from Zod schemas

### Authentication

All POS endpoints require API key authentication:

```
x-api-key: your-pos-provider-api-key
```

### Error Handling

Consistent error responses with source tracking:

```json
{
  "status": 400,
  "message": "Shop not found or inactive",
  "error_source": "client"
}
```

**Error Sources:**

- `client`: Invalid request (400-level errors)
- `server`: Internal server error (500-level errors)
- `pos`: POS system integration error

## 🚀 Deployment

### Railway (Recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway add --database postgresql
railway deploy
```

### Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

### Docker

```bash
# Build and run
docker build -t zvest-backend .
docker run -p 3000:3000 --env-file .env zvest-backend
```

### Traditional VPS

```bash
# Install Bun on server
curl -fsSL https://bun.sh/install | bash

# Clone, install, and run
git clone <repository-url>
cd zvest-backend-pos
bun install
bun run build
bun run start
```

## 🔄 Integration Flow

### Shop Onboarding Process

1. **Business Registration**

   - Zvest admin validates business credentials
   - Shop created in system with `pending` status
   - Admin approves shop → status becomes `active`
   - Shop UUID provided to business for POS integration

2. **POS Integration**

   - POS provider receives shop UUID from business
   - POS calls `/api/pos/shops/sync` with shop UUID and POS data
   - System links POS shop ID with Zvest shop
   - Shop is ready for transactions and loyalty processing

3. **Transaction Flow**
   - POS saves transaction via `/api/pos/transactions`
   - Customer receives receipt with QR code (contains shop_id + invoice_id)
   - Customer scans QR via `/api/customers/scan`
   - Loyalty points/stamps automatically awarded

### Security Considerations

- Only `active` shops can process transactions
- POS providers can only access their own shops
- API keys are unique per POS provider (not per shop)
- All sensitive operations require proper authentication

## 🧪 Testing

Use the provided HTTP test collection:

```bash
# Open tests/api-examples.http in VS Code with REST Client extension
# Or use any HTTP client like Postman/Insomnia
```

## 📝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## 📄 License

This project is licensed under the MIT License.
