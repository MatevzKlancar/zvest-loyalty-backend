# 🧪 POS Coupon Testing Guide (Secure with Supabase Auth)

This guide helps POS engineers test the complete coupon flow with **proper authentication** using Supabase Auth. No more security vulnerabilities - customers must be authenticated to activate coupons.

## ⚠️ Important: API Endpoint Separation

**For POS Integration, ONLY use these endpoints:**
- `GET /api/pos/shops/{shop_id}/coupons` - Get available coupons for display
- `POST /api/pos/coupons/validate` - Validate and redeem customer QR codes
- All other `/api/pos/*` endpoints for transactions, articles, etc.

**DO NOT use these endpoints in POS systems:**
- `/api/app/coupons/{id}/activate` - This is for customer mobile apps only
- `/api/shop-admin/*` - These are for shop owner dashboard only
- `/api/admin/*` - These are for platform administration only

**Why this matters:**
- POS endpoints return **POS article IDs** (e.g., "2493", "coffee-latte")  
- Customer/admin endpoints return **internal UUIDs** (e.g., "bdbc6ca1-be12-46cd-b978-318f95aaf17f")
- Mixing endpoints will cause article ID confusion

## 📋 Overview

The coupon system has 3 main steps:

1. **Coupon Creation** - Shop admin creates coupons
2. **Coupon Activation** - Authenticated customer redeems points for a coupon (generates QR code)
3. **POS Validation** - Staff scans QR code and applies discount

## 🔧 Prerequisites

Before testing, ensure you have:

- Admin access to the dashboard (`/api/admin` endpoints)
- POS API key for your POS provider
- A test shop with articles and loyalty program set up

## 🚀 Complete Testing Flow

### Quick Start Summary

1. **Admin creates test customer** → Get email/password credentials
2. **Use Supabase client to sign in** → Get JWT token
3. **Shop admin creates coupons** → Get coupon IDs
4. **Customer activates coupon** (with JWT) → Get redemption code
5. **POS validates redemption code** → Apply discount

### Step 1: Create Test Customer with Authentication

#### 1.1 Create Test Customer (New Secure Method)

```bash
# Create a test customer with Supabase Auth account
POST /api/admin/testing/create-test-customer
Authorization: Bearer YOUR_ADMIN_JWT
{
  "email": "testcustomer@example.com",
  "password": "TestPassword123!",
  "first_name": "Test",
  "last_name": "Customer",
  "phone": "+1234567890",
  "initial_points": 2000
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Test customer created successfully",
  "data": {
    "customer": {
      "id": "customer-uuid",
      "email": "testcustomer@example.com",
      "supabase_user_id": "auth-user-id"
    },
    "test_jwt_token": "Please use Supabase client to sign in with the credentials above to get JWT token",
    "loyalty_accounts": [
      {
        "shop_id": "shop-uuid",
        "shop_name": "Test Coffee Shop",
        "points_balance": 2000
      }
    ],
    "usage_instructions": {
      "login": "Use email: testcustomer@example.com, password: TestPassword123!",
      "api_testing": "Sign in with Supabase client using the credentials above to get JWT token",
      "points_available": 2000
    }
  }
}
```

**✅ Benefits of New Approach:**

- ✅ **Secure** - Only authenticated customers can activate coupons
- ✅ **Realistic** - Same auth flow as real mobile app
- ✅ **Test-friendly** - Admin creates test customers with JWT tokens
- ✅ **No impersonation** - Can't steal other customers' points

### Step 2: Create Test Coupons

#### 2.1 Create Percentage Discount Coupon

```bash
POST /api/shop-admin/coupons
Authorization: Bearer YOUR_SHOP_ADMIN_JWT
{
  "type": "percentage",
  "name": "20% Off Coffee",
  "description": "Get 20% off any coffee purchase",
  "points_required": 500,
  "articles": [
    {
      "article_id": null,
      "article_name": "All items",
      "discount_value": 20
    }
  ],
  "is_active": true
}
```

#### 2.2 Create Fixed Discount Coupon

```bash
POST /api/shop-admin/coupons
Authorization: Bearer YOUR_SHOP_ADMIN_JWT
{
  "type": "fixed",
  "name": "€5 Off",
  "description": "Get €5 off your purchase",
  "points_required": 300,
  "articles": [
    {
      "article_id": null,
      "article_name": "All items",
      "discount_value": 5.00
    }
  ],
  "is_active": true
}
```

#### 2.3 Create Free Item Coupon

```bash
POST /api/shop-admin/coupons
Authorization: Bearer YOUR_SHOP_ADMIN_JWT
{
  "type": "percentage",
  "name": "Free Coffee",
  "description": "Get a free coffee (any size)",
  "points_required": 800,
  "articles": [
    {
      "article_id": "YOUR_COFFEE_ARTICLE_ID",
      "article_name": "Coffee (Any Size)",
      "discount_value": 100
    }
  ],
  "is_active": true
}
```

### Step 3: Activate Coupon (Secure Method)

This simulates what happens when an authenticated customer activates a coupon in the mobile app.

#### 3.1 Get JWT Token First

Since the test customer creation gives you credentials, you need to get a JWT token using Supabase client:

```javascript
// Use Supabase client to get JWT token
import { createClient } from "@supabase/supabase-js";

const supabase = createClient("YOUR_SUPABASE_URL", "YOUR_SUPABASE_ANON_KEY");

// Sign in with test customer credentials
const { data, error } = await supabase.auth.signInWithPassword({
  email: "testcustomer@example.com",
  password: "TestPassword123!",
});

if (data.session) {
  const jwt_token = data.session.access_token;
  console.log("Use this JWT token:", jwt_token);
}
```

#### 3.2 Activate a Coupon (Authenticated Customer)

```bash
POST /api/app/coupons/{COUPON_ID}/activate
Authorization: Bearer YOUR_JWT_TOKEN_FROM_STEP_3.1
Content-Type: application/json
# No body needed - customer identified from authenticated JWT token
```

**🔐 Security Notes:**

- Customer must be authenticated with valid JWT token
- JWT token identifies which customer is making the request
- No email in request body - prevents impersonation attacks
- Only verified customers can activate coupons

**Expected Response:**

```json
{
  "success": true,
  "message": "Coupon activated successfully",
  "data": {
    "redemption_id": "A12-345",
    "qr_code_data": "A12-345",
    "coupon": {
      "id": "coupon-uuid",
      "type": "percentage",
      "name": "20% Off Coffee",
      "description": "Get 20% off any coffee purchase"
    },
    "customer": {
      "email": "testcustomer@example.com",
      "points_balance_before": 2000,
      "points_balance_after": 1500,
      "points_redeemed": 500
    },
    "expires_at": "2024-01-15T10:05:00.000Z",
    "valid_for_minutes": 5,
    "usage_instructions": "Show QR code or tell staff: \"A12-345\" (6 digits) - Valid for 5 minutes"
  }
}
```

**⚠️ Important:** The redemption code expires in **5 minutes**! Proceed quickly to Step 4.

### Step 4: Test POS Validation

This is what the POS system does when staff scans the QR code.

#### 4.1 Validate and Redeem Coupon

```bash
POST /api/pos/coupons/validate
x-api-key: YOUR_POS_API_KEY
{
  "shop_id": "YOUR_SHOP_ID",
  "redemption_id": "A12-345"
}
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Coupon validated and redeemed successfully",
  "data": {
    "redemption_id": "A12-345",
    "coupon": {
      "id": "coupon-uuid",
      "name": "20% Off Coffee",
      "description": "Get 20% off any coffee purchase",
      "type": "percentage",
      "articles": [
        {
          "article_id": null,
          "article_name": "All items",
          "discount_value": 20
        }
      ]
    },
    "shop": {
      "id": "shop-uuid",
      "name": "Test Coffee Shop"
    },
    "valid": true,
    "message": "Coupon redeemed successfully. Apply 20% discount (applies to entire order)"
  }
}
```

## 🎯 Test Scenarios

### Scenario 1: Happy Path - Percentage Discount

1. Create test customer with 2000 points
2. Create 20% discount coupon (500 points required)
3. Customer authenticates and activates coupon → 1500 points remaining
4. POS validates code → Gets 20% discount instruction
5. ✅ **Expected**: POS applies 20% discount to entire order

### Scenario 2: Authentication Required

1. Try to activate coupon without JWT token
2. ❌ **Expected**: 401 "Authentication required"
3. Try with invalid JWT token
4. ❌ **Expected**: 401 "Invalid token"

### Scenario 3: Customer Authorization

1. Customer A tries to activate coupon
2. Only Customer A can activate their own coupons
3. ✅ **Expected**: Secure - no impersonation possible

### Scenario 4: Insufficient Points

1. Customer has 100 points
2. Try to activate 500-point coupon
3. ❌ **Expected**: Error "Insufficient loyalty points"

### Scenario 5: Expired Redemption Code

1. Activate coupon successfully
2. Wait 6 minutes (codes expire in 5 minutes)
3. Try to validate expired code
4. ❌ **Expected**: Error "Coupon redemption has expired"

### Scenario 6: Already Used Code

1. Activate coupon → Get redemption code
2. Validate code successfully (first time)
3. Try to validate same code again
4. ❌ **Expected**: Error "Invalid or already used coupon redemption"

## 📊 Monitoring & Debugging

### Check Customer Points Balance

```bash
# Get all coupons for a shop (to find coupon IDs)
GET /api/shop-admin/coupons
Authorization: Bearer YOUR_SHOP_ADMIN_JWT
```

### View Shop Details

```bash
GET /api/shop-admin/shop
Authorization: Bearer YOUR_SHOP_ADMIN_JWT
```

### Check Available Coupons (Public)

```bash
GET /api/public/shops/{shop_id}/coupons
# No authentication needed - this is public
```

## 🔄 Reset Test Data

### Create New Test Customer

```bash
# Simply create another test customer with different email
POST /api/admin/testing/create-test-customer
Authorization: Bearer YOUR_ADMIN_JWT
{
  "email": "testcustomer2@example.com",
  "password": "TestPassword123!",
  "first_name": "Test2",
  "last_name": "Customer",
  "initial_points": 2000
}
```

### Reset Customer Points (if needed)

```bash
# Create a new test customer instead - easier than resetting points
POST /api/admin/testing/create-test-customer
Authorization: Bearer YOUR_ADMIN_JWT
{
  "email": "testcustomer3@example.com",
  "password": "TestPassword123!",
  "first_name": "Test3",
  "last_name": "Customer",
  "initial_points": 2000
}
```

## 🚨 Error Scenarios to Test

| Scenario                       | Expected Error                                      | Status Code |
| ------------------------------ | --------------------------------------------------- | ----------- |
| No Authorization header        | "Authentication required"                           | 401         |
| Invalid JWT token              | "Invalid token"                                     | 401         |
| Non-customer user              | "Customer access required"                          | 403         |
| Invalid redemption code format | "Invalid redemption code format - must be 6 digits" | 400         |
| Non-existent redemption code   | "Invalid or already used coupon redemption"         | 400         |
| Expired redemption (>5 min)    | "Coupon redemption has expired"                     | 400         |
| Wrong shop ID                  | "Coupon does not belong to this shop"               | 400         |
| Inactive coupon                | "Coupon not found or not available"                 | 404         |
| Insufficient points            | "Insufficient loyalty points"                       | 400         |

## 💡 Integration Tips for POS Systems

### Handling Different Coupon Types

```javascript
// POS Integration Logic
function applyCouponDiscount(coupon, orderItems, orderTotal) {
  coupon.articles.forEach((article) => {
    if (article.article_id === null) {
      // Apply to entire order
      if (coupon.type === "percentage") {
        totalDiscount = orderTotal * (article.discount_value / 100);
      } else if (coupon.type === "fixed") {
        totalDiscount = article.discount_value;
      }
    } else {
      // Apply to specific item
      const targetItem = orderItems.find(
        (item) => item.pos_article_id === article.article_id
      );
      if (targetItem) {
        if (coupon.type === "percentage") {
          itemDiscount = targetItem.price * (article.discount_value / 100);
        } else if (coupon.type === "fixed") {
          itemDiscount = Math.min(article.discount_value, targetItem.price);
        }
      }
    }
  });
}
```

### QR Code Processing

- QR codes contain the redemption ID directly (e.g., "A12-345")
- No additional parsing needed
- Always validate format: `[A-Z]\d{2}-\d{3}`

## 🔐 Authentication Flow for Mobile Apps

### Customer Login (Supabase Auth)

```javascript
// In your mobile app - customer login
const { data, error } = await supabase.auth.signInWithPassword({
  email: "testcustomer@example.com",
  password: "TestPassword123!",
});

// Get JWT token for API calls
const jwt_token = data.session.access_token;

// Use token in API requests
fetch("/api/app/coupons/coupon-id/activate", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${jwt_token}`,
    "Content-Type": "application/json",
  },
  // No body needed - customer identified from token
});
```

### Alternative: Using curl with JWT token

```bash
# First, get JWT token using a simple script or Postman with Supabase Auth
# Then use it in curl commands:

curl -X POST 'http://localhost:3000/api/app/coupons/your-coupon-id/activate' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json'
```

### Customer Registration (Supabase Auth)

```javascript
// In your mobile app - customer signup
const { data, error } = await supabase.auth.signUp({
  email: "newcustomer@example.com",
  password: "SecurePassword123!",
});

// Create app_users record after successful signup
// (This would typically be done via database trigger or webhook)
```

## 📞 Support

If you encounter issues during testing:

1. **Authentication Issues:**

   - Verify JWT token is valid and not expired
   - Check that test customer exists in both Supabase Auth and app_users table
   - Ensure customer is verified (`is_verified: true`)

2. **Coupon Activation Issues:**

   - Verify customer has sufficient loyalty points
   - Check that coupon is active and not expired
   - Ensure customer has loyalty account for the shop

3. **POS Validation Issues:**

   - Verify POS API key is correct
   - Check redemption code format (A12-345)
   - Remember codes expire in 5 minutes
   - Ensure shop belongs to POS provider

4. **General Debugging:**
   - Check server logs for detailed error messages
   - Use admin endpoints to verify test data setup
   - Contact development team with specific error messages

---

## 🎉 **Security Improvements Summary**

### ❌ **Old Insecure Method:**

```bash
# Anyone could impersonate any customer
POST /api/app/coupons/123/activate
{
  "customer_email": "victim@example.com"  # No verification!
}
```

### ✅ **New Secure Method:**

```bash
# Customer must be authenticated
POST /api/app/coupons/123/activate
Authorization: Bearer CUSTOMER_JWT_TOKEN
# Customer identified from verified JWT - no impersonation possible
```

**Happy Testing! 🎉**

> This secure testing flow ensures your POS integration handles all coupon scenarios correctly while maintaining proper security before going live with real customers.
