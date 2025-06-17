# Zvest Loyalty Platform - Complete Flow Guide

## Overview

The Zvest Loyalty Platform enables businesses to offer loyalty programs through POS system integration. Customers earn points by scanning QR codes printed on their receipts, creating a seamless loyalty experience.

## Architecture

- **Platform Database**: Shared database for small businesses
- **Enterprise Database**: Dedicated databases for large customers (future)
- **Multi-tenant Ready**: Designed to scale from platform to enterprise customers
- **POS Integration**: Single API for all POS providers
- **Mobile App Integration**: Simple QR scanning for customers

## Complete End-to-End Flow

### Phase 1: Business Onboarding (Admin)

#### Step 1: Create B2B Customer

Create a new business customer in the platform.

```http
POST /api/admin/customers
Content-Type: application/json

{
  "name": "Prague Coffee Chain",
  "type": "platform",
  "subscription_tier": "basic"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Customer created successfully",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Prague Coffee Chain",
    "type": "platform",
    "subscription_tier": "basic",
    "is_active": true,
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

#### Step 2: Create Shop for Customer

**Option A: User-Friendly (Recommended for manual work)**

```http
POST /api/admin/shops/by-name
Content-Type: application/json

{
  "customer_name": "Prague Coffee Chain",
  "pos_provider_name": "Elektronček POS",
  "name": "Coffee Shop Wenceslas Square",
  "description": "Main branch in city center",
  "address": "Wenceslas Square 1, Prague 11000",
  "phone": "+420 123 456 789",
  "email": "wenceslas@praguecoffee.cz",
  "type": "coffee"
}
```

**Option B: With IDs (For programmatic access)**

```http
POST /api/admin/shops
Content-Type: application/json

{
  "customer_id": "550e8400-e29b-41d4-a716-446655440000",
  "pos_provider_id": "660f8400-e29b-41d4-a716-446655440001",
  "name": "Coffee Shop Wenceslas Square",
  "description": "Main branch in city center",
  "address": "Wenceslas Square 1, Prague 11000",
  "phone": "+420 123 456 789",
  "email": "wenceslas@praguecoffee.cz",
  "type": "coffee"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Shop created successfully",
  "data": {
    "id": "770g8400-e29b-41d4-a716-446655440002",
    "customer_id": "550e8400-e29b-41d4-a716-446655440000",
    "pos_provider_id": "660f8400-e29b-41d4-a716-446655440001",
    "name": "Coffee Shop Wenceslas Square",
    "status": "pending",
    "customer_name": "Prague Coffee Chain",
    "pos_provider_name": "Elektronček POS",
    "created_at": "2024-01-15T10:05:00Z"
  }
}
```

### Phase 2: POS System Integration

#### Step 3: POS Provider Gets Shop List

The POS provider fetches all shops they need to integrate with.

```http
GET /api/pos/shops
X-API-Key: test-api-key-elektronček-pos-2024
```

**Response:**

```json
{
  "success": true,
  "message": "Shops retrieved successfully",
  "data": [
    {
      "id": "770g8400-e29b-41d4-a716-446655440002",
      "pos_shop_id": null,
      "name": "Coffee Shop Wenceslas Square",
      "description": "Main branch in city center",
      "type": "coffee",
      "status": "pending",
      "pos_synced_at": null,
      "created_at": "2024-01-15T10:05:00Z"
    }
  ]
}
```

#### Step 4: Enable Shop in POS System

POS provider activates the shop and assigns their internal shop ID.

```http
POST /api/pos/shops/770g8400-e29b-41d4-a716-446655440002/enable
X-API-Key: test-api-key-elektronček-pos-2024
Content-Type: application/json

{
  "pos_shop_id": "SHOP_001_WENCESLAS",
  "pos_data": {
    "terminal_count": 2,
    "location_code": "PRG_WEN_001"
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Shop enabled successfully",
  "data": {
    "id": "770g8400-e29b-41d4-a716-446655440002",
    "pos_shop_id": "SHOP_001_WENCESLAS",
    "name": "Coffee Shop Wenceslas Square",
    "status": "active",
    "pos_synced_at": "2024-01-15T10:10:00Z"
  }
}
```

#### Step 5: Sync Menu/Articles

POS provider sends the shop's menu items to create the product catalog.

```http
POST /api/pos/shops/770g8400-e29b-41d4-a716-446655440002/articles
X-API-Key: test-api-key-elektronček-pos-2024
Content-Type: application/json

{
  "articles": [
    {
      "pos_article_id": "COFFEE_ESP",
      "name": "Espresso",
      "price": 2.50,
      "description": "Classic espresso shot",
      "category": "beverages",
      "type": "coffee",
      "tax_type": "standard",
      "tax_rate": 21.0
    },
    {
      "pos_article_id": "COFFEE_CAP",
      "name": "Cappuccino",
      "price": 3.50,
      "description": "Espresso with steamed milk foam",
      "category": "beverages",
      "type": "coffee",
      "tax_type": "standard",
      "tax_rate": 21.0
    },
    {
      "pos_article_id": "PASTRY_CROIS",
      "name": "Croissant",
      "price": 2.80,
      "description": "Fresh butter croissant",
      "category": "pastries",
      "type": "food",
      "tax_type": "standard",
      "tax_rate": 21.0
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Articles synced successfully",
  "data": {
    "synced_count": 3
  }
}
```

### Phase 3: Transaction Processing

#### Step 6: Customer Purchase - Create Transaction

When a customer makes a purchase, the POS terminal creates a transaction in our system.

```http
POST /api/pos/transactions
X-API-Key: test-api-key-elektronček-pos-2024
Content-Type: application/json

{
  "shop_id": "770g8400-e29b-41d4-a716-446655440002",
  "pos_invoice_id": "INV-2024-001234",
  "total_amount": 8.80,
  "tax_amount": 1.53,
  "items": [
    {
      "pos_article_id": "COFFEE_CAP",
      "name": "Cappuccino",
      "quantity": 2,
      "unit_price": 3.50,
      "total_price": 7.00,
      "tax_rate": 21.0
    },
    {
      "pos_article_id": "PASTRY_CROIS",
      "name": "Croissant",
      "quantity": 1,
      "unit_price": 2.80,
      "total_price": 2.80,
      "tax_rate": 21.0
    }
  ],
  "metadata": {
    "terminal_id": "TERM_001",
    "cashier_id": "CASHIER_123"
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Transaction created successfully",
  "data": {
    "id": "880h8400-e29b-41d4-a716-446655440003",
    "shop_id": "770g8400-e29b-41d4-a716-446655440002",
    "pos_invoice_id": "INV-2024-001234",
    "total_amount": 8.8,
    "status": "pending",
    "qr_code_data": "PLT_880h8400-e29b-41d4-a716-446655440003",
    "created_at": "2024-01-15T14:30:00Z"
  }
}
```

#### Step 7: Get QR Code Data for Receipt

POS system requests QR code data and display text to print on the receipt.

```http
GET /api/pos/transactions/880h8400-e29b-41d4-a716-446655440003/qr-data
X-API-Key: test-api-key-elektronček-pos-2024
```

**Response:**

```json
{
  "success": true,
  "message": "QR data retrieved successfully",
  "data": {
    "qr_code_data": "PLT_880h8400-e29b-41d4-a716-446655440003",
    "display_text": "Scan for loyalty points\nInvoice: INV-2024-001234",
    "transaction_id": "880h8400-e29b-41d4-a716-446655440003",
    "shop_name": "Coffee Shop Wenceslas Square",
    "total_amount": 8.8
  }
}
```

**Receipt Format:**

```
================================
    Coffee Shop Wenceslas Square
================================
2x Cappuccino         € 7.00
1x Croissant          € 2.80
--------------------------------
Total:                € 8.80
Tax (21%):            € 1.53
================================

[QR CODE: PLT_880h8400-e29b-41d4-a716-446655440003]

Scan for loyalty points
Invoice: INV-2024-001234

Thank you for your visit!
================================
```

### Phase 4: Customer Loyalty (Mobile App)

#### Step 8: Customer Scans QR Code

Customer uses the mobile app to scan the QR code and earn loyalty points.

```http
POST /api/app/scan-qr
Content-Type: application/json

{
  "qr_code_data": "PLT_880h8400-e29b-41d4-a716-446655440003",
  "phone_number": "+420 987 654 321"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Points awarded successfully",
  "data": {
    "transaction": {
      "id": "880h8400-e29b-41d4-a716-446655440003",
      "shop_id": "770g8400-e29b-41d4-a716-446655440002",
      "pos_invoice_id": "INV-2024-001234",
      "total_amount": 8.80,
      "tax_amount": 1.53,
      "items": [...],
      "loyalty_points_awarded": 88,
      "status": "completed",
      "qr_scanned_at": "2024-01-15T14:35:00Z",
      "created_at": "2024-01-15T14:30:00Z",
      "shop": {
        "name": "Coffee Shop Wenceslas Square",
        "type": "coffee"
      }
    },
    "points_awarded": 88,
    "message": "Congratulations! You earned 88 points.",
    "loyalty_account": {
      "points_balance": 88,
      "total_spent": 8.80
    }
  }
}
```

## API Endpoints Reference

### Admin Endpoints (Business Management)

| Method | Endpoint                   | Description                      |
| ------ | -------------------------- | -------------------------------- |
| `POST` | `/api/admin/customers`     | Create new B2B customer          |
| `GET`  | `/api/admin/customers`     | List all customers               |
| `POST` | `/api/admin/shops`         | Create shop (with customer_id)   |
| `POST` | `/api/admin/shops/by-name` | Create shop (with customer_name) |
| `GET`  | `/api/admin/pos-providers` | List POS providers               |

### POS Integration Endpoints (Authenticated with X-API-Key)

| Method | Endpoint                             | Description                    |
| ------ | ------------------------------------ | ------------------------------ |
| `GET`  | `/api/pos/shops`                     | Get all shops for POS provider |
| `POST` | `/api/pos/shops/{id}/enable`         | Enable shop in POS system      |
| `POST` | `/api/pos/shops/{id}/articles`       | Sync shop menu/articles        |
| `POST` | `/api/pos/transactions`              | Create transaction from POS    |
| `GET`  | `/api/pos/transactions/{id}/qr-data` | Get QR data for receipt        |

### Customer App Endpoints (Public)

| Method | Endpoint                     | Description                   |
| ------ | ---------------------------- | ----------------------------- |
| `POST` | `/api/app/scan-qr`           | Scan QR code and award points |
| `GET`  | `/api/app/transactions/{id}` | Get transaction details       |

## Authentication

### POS Provider Authentication

All POS endpoints require authentication via API key:

```
X-API-Key: your-pos-provider-api-key
```

### Admin Endpoints

Currently open (add authentication as needed)

### Customer App Endpoints

Currently open (customers identified by phone/email)

## Database Schema

### Key Tables:

- **customers**: B2B customers (platform/enterprise)
- **pos_providers**: POS system providers
- **shops**: Individual shop locations
- **articles**: Menu items/products
- **loyalty_programs**: Point earning rules
- **app_users**: Mobile app customers
- **customer_loyalty_accounts**: User loyalty per shop
- **transactions**: Purchase records
- **transaction_logs**: Audit trail

## QR Code Format

- **Platform customers**: `PLT_{transaction_id}`
- **Enterprise customers**: `ENT_{transaction_id}` (future)
- **One-time use**: QR becomes invalid after scanning
- **Secure**: UUIDs prevent guessing

## Points Calculation

Based on loyalty program configuration:

- **Points per Euro**: e.g., 10 points per €1 spent
- **Example**: €8.80 purchase = 88 points (8.80 × 10)
- **Rounding**: Always round down (`Math.floor()`)

## Error Handling

All endpoints return standardized responses:

**Success:**

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... }
}
```

**Error:**

```json
{
  "success": false,
  "message": "Descriptive error message",
  "error_source": "client|server"
}
```

## Development Setup

1. **Database**: Apply `database/platform-schema-simple.sql` to Supabase
2. **Environment**: Configure `.env` with database credentials
3. **Start**: `bun run dev`
4. **Documentation**: Visit `http://localhost:3000/api/docs`

## Testing Flow

1. **Create customer**: `POST /api/admin/customers`
2. **Create shop**: `POST /api/admin/shops/by-name`
3. **Enable shop**: `POST /api/pos/shops/{id}/enable`
4. **Sync menu**: `POST /api/pos/shops/{id}/articles`
5. **Create transaction**: `POST /api/pos/transactions`
6. **Get QR data**: `GET /api/pos/transactions/{id}/qr-data`
7. **Scan QR**: `POST /api/app/scan-qr`

## Production Considerations

- **Rate Limiting**: Add rate limits on public endpoints
- **Authentication**: Implement proper admin authentication
- **Webhooks**: Add webhook support for real-time notifications
- **Monitoring**: Add transaction and performance monitoring
- **Scaling**: Database partitioning for high-volume customers

## Future Enterprise Features

- **Dedicated Databases**: Each enterprise customer gets own DB
- **Advanced Analytics**: Custom reporting and insights
- **White-label Apps**: Branded mobile apps
- **Advanced Loyalty**: Tiered programs, special offers
- **Multi-location**: Centralized management for chains
