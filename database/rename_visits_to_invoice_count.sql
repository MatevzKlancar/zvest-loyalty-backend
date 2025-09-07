-- ===================================================================
-- ADD invoice_count COLUMN TO customer_loyalty_accounts
-- ===================================================================
-- This migration adds the invoice_count field to the customer_loyalty_accounts 
-- table to track the number of invoices/transactions per customer per shop.
-- ===================================================================

-- Add the invoice_count column (defaults to 0 for existing records)
ALTER TABLE customer_loyalty_accounts 
ADD COLUMN IF NOT EXISTS invoice_count INTEGER DEFAULT 0;

-- Add check constraint to ensure invoice_count is non-negative
ALTER TABLE customer_loyalty_accounts 
ADD CONSTRAINT customer_loyalty_accounts_invoice_count_check 
CHECK (invoice_count >= 0);

-- Update existing records to set invoice_count based on transaction count
-- This gives existing loyalty accounts a starting point based on their transaction history
UPDATE customer_loyalty_accounts 
SET invoice_count = (
    SELECT COUNT(*) 
    FROM transactions 
    WHERE transactions.loyalty_account_id = customer_loyalty_accounts.id 
    AND transactions.qr_scanned_at IS NOT NULL
    AND transactions.status = 'completed'
)
WHERE invoice_count = 0;

-- ===================================================================
-- VERIFICATION QUERIES (Optional - to check the migration worked)
-- ===================================================================

-- Check that the column was added successfully
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns 
-- WHERE table_name = 'customer_loyalty_accounts' 
-- AND column_name = 'invoice_count';

-- Check constraint exists
-- SELECT constraint_name, check_clause 
-- FROM information_schema.check_constraints 
-- WHERE constraint_name LIKE '%invoice_count%';

-- Verify some records have been updated
-- SELECT id, invoice_count FROM customer_loyalty_accounts LIMIT 5;

-- ===================================================================
-- MIGRATION COMPLETE ✅
-- ===================================================================
-- The invoice_count field has been added to customer_loyalty_accounts
-- Existing records updated with historical transaction counts
-- Check constraint ensures data integrity
-- ===================================================================