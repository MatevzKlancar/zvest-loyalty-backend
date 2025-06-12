# POS Integration Guide - Zvest Loyalty Platform

## Overview

This document outlines the technical integration between your POS system and the Zvest Loyalty Platform. The integration allows your customers (businesses) to offer loyalty programs to their end customers through a unified platform.

## Integration Architecture

### Business Flow

1. **Shop Pre-registration**: Zvest admin creates and approves shops in our system
2. **POS Integration**: Your system syncs shop data with our pre-registered shops
3. **Transaction Processing**: Your POS sends transaction data for loyalty point calculation
4. **Customer Rewards**: End customers scan QR codes to earn loyalty points/stamps

### Technical Flow

```
[Your POS] → [Zvest API] → [Loyalty Processing] → [Customer App]
```

## Prerequisites

### Authentication

- You will receive a unique **API Key** for your POS provider account
- All API calls require the header: `x-api-key: your-api-key`
- API key grants access to all shops using your POS system

### Base URL

```
Production: https://api.zvest.com
Staging: https://staging-api.zvest.com
```

## Integration Steps

### Step 1: Shop Sync Process

When a business customer wants to activate loyalty programs:

1. **Business provides Shop UUID**: The business receives a `shop_uuid` from Zvest after admin approval
2. **Your POS syncs shop data**: You call our sync endpoint to link your POS shop with our system

#### Endpoint: Sync Shop Data

```http
POST /api/pos/shops/sync
Content-Type: application/json
x-api-key: your-api-key

{
  "shop_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "pos_shop_id": "your_internal_shop_id_123",
  "pos_data": {
    "name": "Coffee Corner",
    "location": "123 Main St, City",
    "contact": "+1234567890",
    "operating_hours": {
      "monday": "08:00-18:00",
      "tuesday": "08:00-18:00"
    },
    "additional_data": {
      "pos_version": "2.1.0",
      "currency": "EUR"
    }
  }
}
```

**Response:**

```json
{
  "status": 200,
  "message": "Shop synced successfully",
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "Coffee Corner",
    "status": "active",
    "pos_shop_id": "your_internal_shop_id_123",
    "description": null,
    "type": null,
    "pos_synced_at": "2024-01-15T10:30:00Z",
    "created_at": "2024-01-15T09:00:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

### Step 2: Menu/Articles Management (Optional)

Update shop menu items for better transaction tracking:

#### Endpoint: Update Shop Articles

```http
POST /api/pos/shops/{shop_uuid}/articles
Content-Type: application/json
x-api-key: your-api-key

{
  "articles": [
    {
      "id": "art_001",
      "name": "Cappuccino",
      "price": 4.50,
      "description": "Coffee with steamed milk foam",
      "type": "beverage"
    },
    {
      "id": "art_002",
      "name": "Croissant",
      "price": 3.20,
      "description": "Fresh buttery croissant",
      "type": "pastry"
    }
  ]
}
```

### Step 3: Transaction Processing

**Critical**: Send transaction data immediately after each sale for loyalty processing.

#### Endpoint: Save Transaction

```http
POST /api/pos/transactions
Content-Type: application/json
x-api-key: your-api-key

{
  "shop_id": "123e4567-e89b-12d3-a456-426614174000",
  "pos_invoice_id": "INV-2024-001234",
  "total_amount": 12.70,
  "items": [
    {
      "article_id": "art_001",
      "name": "Cappuccino",
      "quantity": 2,
      "price": 4.50,
      "total": 9.00
    },
    {
      "article_id": "art_002",
      "name": "Croissant",
      "quantity": 1,
      "price": 3.20,
      "total": 3.20
    }
  ]
}
```

**Response:**

```json
{
  "status": 200,
  "message": "Transaction saved successfully",
  "data": {
    "id": "txn_789xyz",
    "shop_id": "123e4567-e89b-12d3-a456-426614174000",
    "pos_invoice_id": "INV-2024-001234",
    "total_amount": 12.70,
    "items": [...]
  }
}
```

### Step 4: Receipt QR Code Generation

**Important**: Include QR code on customer receipts for loyalty scanning.

#### QR Code Data Format:

```json
{
  "shop_id": "123e4567-e89b-12d3-a456-426614174000",
  "invoice_id": "INV-2024-001234"
}
```

**Implementation**:

- Generate QR code containing the JSON data above
- Print QR code on customer receipt
- Customer scans QR with Zvest app to earn loyalty points

## Additional Endpoints

### Get Your Active Shops

```http
GET /api/pos/shops
x-api-key: your-api-key
```

**Response:**

```json
{
  "status": 200,
  "message": "Shops retrieved successfully",
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Coffee Corner",
      "status": "active",
      "pos_shop_id": "your_internal_shop_id_123",
      "description": null,
      "type": null,
      "pos_synced_at": "2024-01-15T10:30:00Z",
      "created_at": "2024-01-15T09:00:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Get Shop Coupons

```http
GET /api/pos/shops/{shop_uuid}/coupons
x-api-key: your-api-key
```

### Validate Customer Coupon

```http
POST /api/pos/coupons/validate
Content-Type: application/json
x-api-key: your-api-key

{
  "shop_id": "123e4567-e89b-12d3-a456-426614174000",
  "coupon_id": "456e7890-e89b-12d3-a456-426614174001"
}
```

## Error Handling

### Standard Error Response Format:

```json
{
  "status": 400,
  "message": "Shop not found or inactive",
  "error_source": "client"
}
```

### Error Sources:

- `client`: Invalid request (fix on your side)
- `server`: Our server error (contact support)
- `pos`: POS integration specific error

### Common Error Scenarios:

#### Shop Not Found (404)

```json
{
  "status": 404,
  "message": "Shop with UUID not found",
  "error_source": "client"
}
```

#### Shop Inactive (400)

```json
{
  "status": 400,
  "message": "Shop is not active for transactions",
  "error_source": "client"
}
```

#### Invalid API Key (401)

```json
{
  "status": 401,
  "message": "Invalid or missing API key",
  "error_source": "client"
}
```

## Data Requirements

### Required Fields for Integration:

#### Shop Sync:

- ✅ `shop_uuid` (provided by business)
- ✅ `pos_shop_id` (your internal shop identifier)
- ✅ `pos_data` object (shop information from POS)

#### Transaction Processing:

- ✅ `shop_id` (shop UUID)
- ✅ `pos_invoice_id` (your invoice number)
- ✅ `total_amount` (transaction total)
- ✅ `items` array (for detailed tracking)

#### Receipt QR Code:

- ✅ Include QR code with shop_id + invoice_id
- ✅ QR code must be scannable by mobile apps

## Testing & Validation

### Test Scenarios:

1. **Shop Sync**: Test with a sample shop UUID
2. **Transaction Flow**: Send test transactions
3. **QR Code**: Verify QR code format and scannability
4. **Error Handling**: Test invalid shop UUIDs, wrong API keys

### Test Data:

We'll provide you with:

- Test API key
- Sample shop UUIDs
- Staging environment access

## Integration Checklist

- [ ] API key authentication implemented
- [ ] Shop sync endpoint integration
- [ ] Transaction posting after each sale
- [ ] QR code generation on receipts
- [ ] Error handling for all scenarios
- [ ] Test with staging environment
- [ ] Production deployment ready

## Support & Documentation

### API Documentation:

- Interactive docs: `https://api.zvest.com/docs`
- OpenAPI spec: `https://api.zvest.com/api-spec`

### Technical Support:

- Email: tech-support@zvest.com
- Response time: 24 hours
- Integration assistance available

## Security Considerations

1. **API Key Security**: Store API keys securely, never expose in client-side code
2. **HTTPS Only**: All API calls must use HTTPS
3. **Shop Validation**: Only sync shops with valid UUIDs from verified businesses
4. **Data Privacy**: Handle customer data according to GDPR/local privacy laws

## Performance Requirements

- **Transaction Processing**: Real-time (< 2 seconds after sale)
- **Shop Sync**: Can be done during setup/configuration
- **API Rate Limits**: 1000 requests per minute per API key
- **Timeout**: 30 seconds for all API calls

## Questions to Consider

1. **Can your POS system make HTTP API calls** to external services?
2. **Can you generate and print QR codes** on receipts?
3. **Do you have access to transaction data** (items, amounts, invoice IDs)?
4. **Can you store additional shop configuration** (shop UUIDs, loyalty settings)?
5. **What's your deployment process** for integrating new API endpoints?

---

**Next Steps**: Please review this integration guide and let us know:

1. If this integration is technically feasible with your POS system
2. Any technical constraints or modifications needed
3. Estimated timeline for implementation
4. Any additional requirements from your side
