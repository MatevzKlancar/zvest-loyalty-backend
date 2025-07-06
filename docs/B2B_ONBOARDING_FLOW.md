# B2B Customer Onboarding Flow

This document describes the production-ready B2B customer onboarding flow for the Zvest Loyalty Platform.

## Overview

The B2B onboarding flow creates a complete setup for new business customers in a secure, streamlined process:

1. **One-Step B2B Registration** - Creates customer, shop, and owner invitation
2. **Secure Invitation System** - Shop owners receive invitation tokens via email
3. **Account Setup** - Shop owners complete their profile and create passwords
4. **Dashboard Access** - Immediate access to shop management dashboard

## Flow Diagram

```
Admin/Sales Team        Shop Owner              System
     |                      |                     |
     | 1. POST /api/admin/  |                     |
     |    onboard-b2b       |                     |
     |------------------->  |                     |
     |                      |                     | 2. Create Customer
     |                      |                     | 3. Create Shop
     |                      |                     | 4. Create Invitation
     |                      |                     | 5. Send Email
     |                      |<--------------------|
     |                      | 6. Setup Email      |
     |                      |    (with token)     |
     |                      |                     |
     |                      | 7. GET /api/admin/  |
     |                      |    invitation/{token}|
     |                      |------------------->|
     |                      |<-------------------|
     |                      | 8. Invitation Details|
     |                      |                     |
     |                      | 9. POST /api/admin/ |
     |                      |    complete-shop-setup|
     |                      |------------------->|
     |                      |                     | 10. Create Auth User
     |                      |                     | 11. Activate Shop
     |                      |                     | 12. Link User to Shop
     |                      |<-------------------|
     |                      | 13. Dashboard Access|
```

## API Endpoints

### 1. Complete B2B Onboarding

**Endpoint:** `POST /api/admin/onboard-b2b`

Creates a complete B2B setup in one API call.

**Request Body:**

```json
{
  "customer_name": "Awesome Coffee Chain",
  "customer_type": "platform",
  "subscription_tier": "premium",
  "shop_name": "Awesome Coffee - Downtown",
  "shop_description": "Premium coffee and pastries in the heart of the city",
  "shop_address": "123 Main Street, Downtown",
  "shop_phone": "+1-555-0123",
  "shop_type": "coffee",
  "pos_provider_name": "Square",
  "owner_email": "owner@awesomecoffee.com",
  "owner_first_name": "John",
  "owner_last_name": "Smith",
  "owner_phone": "+1-555-0124",
  "send_welcome_email": true
}
```

**Response:**

```json
{
  "success": true,
  "message": "B2B onboarding completed successfully",
  "data": {
    "customer": {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Awesome Coffee Chain",
      "type": "platform",
      "subscription_tier": "premium",
      "is_active": true,
      "created_at": "2024-01-15T10:30:00Z"
    },
    "shop": {
      "id": "456e7890-e89b-12d3-a456-426614174000",
      "customer_id": "123e4567-e89b-12d3-a456-426614174000",
      "name": "Awesome Coffee - Downtown",
      "status": "pending_setup",
      "customer_name": "Awesome Coffee Chain",
      "pos_provider_name": "Square"
    },
    "invitation": {
      "id": "789e0123-e89b-12d3-a456-426614174000",
      "email": "owner@awesomecoffee.com",
      "token": "abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
      "expires_at": "2024-01-22T10:30:00Z",
      "setup_url": "https://your-frontend.com/setup?token=abc123def456..."
    }
  }
}
```

### 2. Get Invitation Details

**Endpoint:** `GET /api/admin/invitation/{token}`

Public endpoint for shop owners to view invitation details.

**Response:**

```json
{
  "success": true,
  "message": "Invitation details retrieved successfully",
  "data": {
    "shop_name": "Awesome Coffee - Downtown",
    "customer_name": "Awesome Coffee Chain",
    "owner_name": "John Smith",
    "email": "owner@awesomecoffee.com",
    "expires_at": "2024-01-22T10:30:00Z",
    "is_expired": false
  }
}
```

### 3. Complete Shop Setup

**Endpoint:** `POST /api/admin/complete-shop-setup`

Shop owners use this to complete their account setup.

**Request Body:**

```json
{
  "invitation_token": "abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
  "password": "SecurePassword123!",
  "shop_details": {
    "description": "Updated shop description",
    "address": "123 Updated Address",
    "phone": "+1-555-0125",
    "website": "https://myshop.com",
    "opening_hours": "Mon-Fri: 7:00-19:00, Sat-Sun: 8:00-18:00",
    "loyalty_type": "points"
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Shop setup completed successfully",
  "data": {
    "shop": {
      "id": "456e7890-e89b-12d3-a456-426614174000",
      "name": "Awesome Coffee - Downtown",
      "status": "active",
      "description": "Updated shop description"
    },
    "user": {
      "id": "user_auth_id_from_supabase",
      "email": "owner@awesomecoffee.com"
    },
    "dashboard_url": "https://your-frontend.com/dashboard"
  }
}
```

## Database Schema Changes

### New/Updated Tables

#### `shops` table (updated)

- Added `owner_user_id` field to link to Supabase Auth users
- Added `pending_setup` status for onboarding
- Added `website`, `loyalty_type`, `opening_hours`, `social_media` fields

#### `shop_owner_invitations` table (new)

```sql
CREATE TABLE shop_owner_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    email VARCHAR NOT NULL,
    first_name VARCHAR NOT NULL,
    last_name VARCHAR NOT NULL,
    phone VARCHAR,
    invitation_token VARCHAR UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'cancelled')),
    invited_by VARCHAR,
    completed_at TIMESTAMP WITH TIME ZONE,
    user_id UUID, -- Links to created Supabase Auth user when completed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Frontend Integration

### Setup Page Component

```tsx
// pages/setup.tsx
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function SetupPage() {
  const router = useRouter();
  const { token } = router.query;
  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      fetchInvitation(token as string);
    }
  }, [token]);

  const fetchInvitation = async (invitationToken: string) => {
    try {
      const response = await fetch(`/api/admin/invitation/${invitationToken}`);
      const data = await response.json();

      if (data.success) {
        if (data.data.is_expired) {
          // Handle expired invitation
          router.push("/expired");
          return;
        }
        setInvitation(data.data);
      } else {
        // Handle invalid invitation
        router.push("/invalid");
      }
    } catch (error) {
      console.error("Error fetching invitation:", error);
    } finally {
      setLoading(false);
    }
  };

  const completeSetup = async (setupData: {
    password: string;
    shop_details?: object;
  }) => {
    try {
      const response = await fetch("/api/admin/complete-shop-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitation_token: token,
          ...setupData,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Redirect to dashboard
        window.location.href = data.data.dashboard_url;
      } else {
        // Handle setup error
        console.error("Setup failed:", data.message);
      }
    } catch (error) {
      console.error("Error completing setup:", error);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!invitation) return <div>Invalid invitation</div>;

  return (
    <div>
      <h1>Welcome to {invitation.shop_name}</h1>
      <p>Complete your setup for {invitation.customer_name}</p>
      {/* Setup form here */}
    </div>
  );
}
```

## Email Templates

### Welcome Email Template

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Welcome to Zvest Loyalty Platform</title>
  </head>
  <body>
    <h1>Welcome to {{customer_name}}!</h1>

    <p>Hello {{owner_first_name}},</p>

    <p>
      You've been invited to set up your loyalty program dashboard for
      <strong>{{shop_name}}</strong>.
    </p>

    <p>To complete your setup and start managing your loyalty program:</p>

    <ol>
      <li>Click the button below to access your setup page</li>
      <li>Create your secure password</li>
      <li>Complete your shop profile</li>
      <li>Start engaging with your customers!</li>
    </ol>

    <a
      href="{{setup_url}}"
      style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;"
    >
      Complete Setup
    </a>

    <p>
      <strong>Important:</strong> This invitation expires on {{expires_at}}.
    </p>

    <p>If you have any questions, please contact our support team.</p>

    <p>Best regards,<br />The Zvest Team</p>
  </body>
</html>
```

## Security Features

1. **Token-Based Invitations** - Cryptographically secure invitation tokens
2. **Expiring Invitations** - 7-day expiration prevents stale invitations
3. **Direct User Linking** - Shop owners linked to Supabase Auth users by ID, not email
4. **Status Tracking** - Full audit trail of invitation and setup process
5. **Single-Use Tokens** - Invitations can only be used once

## Production Checklist

### Before Deployment

- [ ] Set up email service (SendGrid, Mailgun, etc.)
- [ ] Configure `FRONTEND_URL` environment variable
- [ ] Run database migrations
- [ ] Test email delivery
- [ ] Set up monitoring for invitation expiry cleanup

### Email Service Integration

```typescript
// services/email.ts
export async function sendWelcomeEmail(
  email: string,
  templateData: {
    customer_name: string;
    owner_first_name: string;
    shop_name: string;
    setup_url: string;
    expires_at: string;
  }
) {
  // Implement your email service here
  // Examples: SendGrid, Mailgun, AWS SES, etc.
}
```

### Monitoring & Cleanup

```sql
-- Clean up expired invitations (run daily)
UPDATE shop_owner_invitations
SET status = 'expired'
WHERE status = 'pending'
AND expires_at < NOW();
```

## Benefits of This Flow

1. **Production Ready** - Secure, scalable, and maintainable
2. **User Friendly** - Simple setup process for shop owners
3. **Secure** - Token-based authentication with proper user linking
4. **Auditable** - Full trail of onboarding process
5. **Flexible** - Supports different customer types and subscription tiers
6. **Self-Service** - Shop owners can complete setup independently

## Migration from Old Flow

If you have existing shops created with the old flow:

1. **Add owner_user_id** to existing shops
2. **Create Supabase Auth users** for existing shop owners
3. **Link users to shops** using the owner_user_id field

```sql
-- Example migration script
-- 1. Add the new column (already done in schema update)
-- 2. For each existing shop with email, create auth user and link
-- This should be done carefully with proper error handling
```

This new flow provides a production-ready B2B onboarding experience that's secure, user-friendly, and scalable.
