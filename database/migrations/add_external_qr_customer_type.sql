-- Migration: Add external-qr-codes customer type
-- Description: Extends customers.type constraint to support new customer type for external QR code feature
-- Date: 2025-12-01

-- Drop existing constraint
ALTER TABLE public.customers
DROP CONSTRAINT IF EXISTS customers_type_check;

-- Add new constraint with external-qr-codes type
ALTER TABLE public.customers
ADD CONSTRAINT customers_type_check
CHECK (type IN ('platform', 'enterprise', 'external-qr-codes'));

-- Add comment to document the new customer type
COMMENT ON COLUMN public.customers.type IS
  'Customer type: "platform" (shared database, regular coupons), "enterprise" (dedicated database, regular coupons), "external-qr-codes" (external QR code vouchers only)';
