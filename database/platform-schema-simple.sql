-- Platform Database Schema - Simple and Clean
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create customers table (enterprise or platform)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR NOT NULL,
    type VARCHAR NOT NULL CHECK (type IN ('platform', 'enterprise')),
    subscription_tier VARCHAR CHECK (subscription_tier IN ('basic', 'premium', 'enterprise')),
    database_config JSONB, -- For enterprise customers, contains their DB connection info
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create POS providers table
CREATE TABLE IF NOT EXISTS pos_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR NOT NULL,
    description TEXT,
    api_key VARCHAR UNIQUE NOT NULL,
    webhook_url VARCHAR,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create shops table
CREATE TABLE IF NOT EXISTS shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    pos_provider_id UUID NOT NULL REFERENCES pos_providers(id) ON DELETE CASCADE,
    pos_shop_id VARCHAR,
    name VARCHAR NOT NULL,
    description TEXT,
    address TEXT,
    phone VARCHAR,
    email VARCHAR,
    type VARCHAR,
    status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'inactive')),
    approved_by VARCHAR,
    approved_at TIMESTAMP WITH TIME ZONE,
    pos_synced_at TIMESTAMP WITH TIME ZONE,
    pos_sync_data JSONB,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(customer_id, pos_provider_id, pos_shop_id)
);

-- Create articles table
CREATE TABLE IF NOT EXISTS articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    pos_article_id VARCHAR NOT NULL,
    name VARCHAR NOT NULL,
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    description TEXT,
    category VARCHAR,
    type VARCHAR,
    tax_type VARCHAR,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(shop_id, pos_article_id)
);

-- Create loyalty programs table
CREATE TABLE IF NOT EXISTS loyalty_programs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    type VARCHAR NOT NULL CHECK (type IN ('points', 'stamps', 'visits')),
    name VARCHAR NOT NULL,
    description TEXT,
    points_per_euro DECIMAL(5,2) CHECK (points_per_euro >= 0),
    stamps_required INTEGER CHECK (stamps_required > 0),
    visits_required INTEGER CHECK (visits_required > 0),
    reward_description TEXT,
    reward_value DECIMAL(10,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create coupons table
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    code VARCHAR UNIQUE NOT NULL,
    type VARCHAR NOT NULL CHECK (type IN ('percentage', 'fixed', 'free_item', 'points_multiplier')),
    value DECIMAL(10,2) NOT NULL CHECK (value >= 0),
    description TEXT,
    min_purchase_amount DECIMAL(10,2) DEFAULT 0,
    max_discount_amount DECIMAL(10,2),
    expires_at TIMESTAMP WITH TIME ZONE,
    usage_limit INTEGER CHECK (usage_limit > 0),
    used_count INTEGER DEFAULT 0 CHECK (used_count >= 0),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create app users table
CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number VARCHAR UNIQUE,
    email VARCHAR UNIQUE,
    first_name VARCHAR,
    last_name VARCHAR,
    date_of_birth DATE,
    is_verified BOOLEAN DEFAULT false,
    verification_code VARCHAR,
    verification_expires_at TIMESTAMP WITH TIME ZONE,
    push_token VARCHAR,
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT check_contact_method CHECK (phone_number IS NOT NULL OR email IS NOT NULL)
);

-- Create customer loyalty accounts
CREATE TABLE IF NOT EXISTS customer_loyalty_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    app_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    loyalty_program_id UUID NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
    points_balance INTEGER DEFAULT 0 CHECK (points_balance >= 0),
    stamps_count INTEGER DEFAULT 0 CHECK (stamps_count >= 0),
    visits_count INTEGER DEFAULT 0 CHECK (visits_count >= 0),
    total_spent DECIMAL(10,2) DEFAULT 0 CHECK (total_spent >= 0),
    last_visit_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(app_user_id, shop_id)
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    pos_invoice_id VARCHAR NOT NULL,
    transaction_number BIGSERIAL,
    total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
    tax_amount DECIMAL(10,2) DEFAULT 0 CHECK (tax_amount >= 0),
    items JSONB NOT NULL,
    app_user_id UUID REFERENCES app_users(id),
    loyalty_account_id UUID REFERENCES customer_loyalty_accounts(id),
    loyalty_points_awarded INTEGER DEFAULT 0 CHECK (loyalty_points_awarded >= 0),
    loyalty_stamps_awarded INTEGER DEFAULT 0 CHECK (loyalty_stamps_awarded >= 0),
    coupon_used_id UUID REFERENCES coupons(id),
    discount_amount DECIMAL(10,2) DEFAULT 0 CHECK (discount_amount >= 0),
    qr_code_data TEXT,
    qr_scanned_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'refunded')),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(shop_id, pos_invoice_id)
);

-- Create transaction_logs table (for audit trail)
CREATE TABLE IF NOT EXISTS transaction_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    action VARCHAR NOT NULL,
    details JSONB DEFAULT '{}',
    performed_by VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ONLY ESSENTIAL INDEXES (the bare minimum)
-- Foreign key indexes (PostgreSQL doesn't auto-create these)
CREATE INDEX idx_shops_customer_id ON shops(customer_id);
CREATE INDEX idx_shops_pos_provider_id ON shops(pos_provider_id);
CREATE INDEX idx_articles_shop_id ON articles(shop_id);
CREATE INDEX idx_loyalty_programs_shop_id ON loyalty_programs(shop_id);
CREATE INDEX idx_coupons_shop_id ON coupons(shop_id);
CREATE INDEX idx_customer_loyalty_accounts_app_user_id ON customer_loyalty_accounts(app_user_id);
CREATE INDEX idx_customer_loyalty_accounts_shop_id ON customer_loyalty_accounts(shop_id);
CREATE INDEX idx_transactions_shop_id ON transactions(shop_id);
CREATE INDEX idx_transaction_logs_transaction_id ON transaction_logs(transaction_id);

-- Critical business logic indexes
CREATE INDEX idx_pos_providers_api_key ON pos_providers(api_key); -- For authentication
CREATE INDEX idx_coupons_code ON coupons(code); -- For coupon lookups
CREATE INDEX idx_transactions_pos_invoice_id ON transactions(pos_invoice_id); -- For POS integration

-- ONLY ONE TRIGGER for updated_at (we'll add it manually where needed)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger only to main tables
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pos_providers_updated_at BEFORE UPDATE ON pos_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shops_updated_at BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Simple QR code generation function
CREATE OR REPLACE FUNCTION generate_qr_code_data(transaction_id UUID, shop_id UUID)
RETURNS TEXT AS $$
BEGIN
    -- Simple format: PLT_{transaction_id}
    RETURN 'PLT_' || transaction_id::text;
END;
$$ LANGUAGE plpgsql;

-- One trigger for QR code generation
CREATE OR REPLACE FUNCTION set_transaction_qr_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.qr_code_data IS NULL THEN
        NEW.qr_code_data := generate_qr_code_data(NEW.id, NEW.shop_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_transaction_qr_code_trigger 
    BEFORE INSERT ON transactions 
    FOR EACH ROW 
    EXECUTE FUNCTION set_transaction_qr_code();

-- Insert sample data for development
INSERT INTO customers (name, type, subscription_tier) VALUES 
('Platform Customers', 'platform', 'basic')
ON CONFLICT DO NOTHING;

INSERT INTO pos_providers (name, description, api_key) VALUES 
('Elektronček POS', 'Primary POS integration partner', 'test-api-key-elektronček-pos-2024')
ON CONFLICT (api_key) DO NOTHING;

-- Insert sample shop for platform customers
DO $$
DECLARE
    platform_customer_id UUID;
    provider_id UUID;
    shop_id UUID;
    loyalty_program_id UUID;
BEGIN
    SELECT id INTO platform_customer_id FROM customers WHERE type = 'platform' LIMIT 1;
    SELECT id INTO provider_id FROM pos_providers WHERE api_key = 'test-api-key-elektronček-pos-2024';
    
    INSERT INTO shops (customer_id, pos_provider_id, name, description, type, status, approved_by, approved_at) VALUES 
    (platform_customer_id, provider_id, 'Test Coffee Shop', 'A sample coffee shop for testing the platform', 'coffee', 'active', 'admin', NOW())
    ON CONFLICT DO NOTHING
    RETURNING id INTO shop_id;
    
    IF shop_id IS NOT NULL THEN
        INSERT INTO loyalty_programs (shop_id, type, name, description, points_per_euro, is_active) VALUES 
        (shop_id, 'points', 'Coffee Points', 'Earn 10 points per euro spent', 10.00, true)
        RETURNING id INTO loyalty_program_id;
        
        INSERT INTO coupons (shop_id, code, type, value, description, usage_limit) VALUES 
        (shop_id, 'WELCOME10', 'percentage', 10.00, '10% discount for new customers', 100);
        
        INSERT INTO articles (shop_id, pos_article_id, name, price, description, category, type) VALUES 
        (shop_id, 'COFFEE_ESP', 'Espresso', 2.50, 'Classic espresso shot', 'beverages', 'coffee'),
        (shop_id, 'COFFEE_CAP', 'Cappuccino', 3.50, 'Espresso with steamed milk foam', 'beverages', 'coffee'),
        (shop_id, 'PASTRY_CROIS', 'Croissant', 2.80, 'Fresh butter croissant', 'pastries', 'food');
    END IF;
END $$; 