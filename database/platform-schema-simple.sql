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

-- Create POS providers table (for reference only - no API keys stored)
CREATE TABLE IF NOT EXISTS pos_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR NOT NULL,
    description TEXT,
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
    base_price DECIMAL(10,2) NOT NULL CHECK (base_price >= 0), -- Default/fallback price
    description TEXT,
    category VARCHAR,
    type VARCHAR,
    tax_type VARCHAR,
    tax_rate DECIMAL(5,2) DEFAULT 0,
    is_coupon_eligible BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(shop_id, pos_article_id)
);

-- Create article pricing table for time-based pricing
CREATE TABLE IF NOT EXISTS article_pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    -- Time-based pricing
    start_time TIME, -- e.g., '08:00:00' for 8am
    end_time TIME,   -- e.g., '10:00:00' for 10am
    -- Date-based pricing (optional)
    start_date DATE, -- e.g., '2024-12-01' for seasonal pricing
    end_date DATE,   -- e.g., '2024-12-31'
    -- Day of week pricing (1=Monday, 7=Sunday)
    days_of_week INTEGER[], -- e.g., [1,2,3,4,5] for weekdays, [6,7] for weekends
    -- Rule priority (higher number = higher priority)
    priority INTEGER DEFAULT 0,
    -- Rule name for admin reference
    name VARCHAR, -- e.g., "Happy Hour", "Morning Special"
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
CREATE INDEX idx_coupons_code ON coupons(code); -- For coupon lookups
CREATE INDEX idx_transactions_pos_invoice_id ON transactions(pos_invoice_id); -- For POS integration
CREATE INDEX idx_article_pricing_article_id ON article_pricing(article_id); -- For price lookups
CREATE INDEX idx_article_pricing_active_priority ON article_pricing(article_id, is_active, priority); -- For current price queries

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

-- No hardcoded sample data - all seeding is handled by the application startup
-- This ensures API keys and test data come from environment configuration 

-- Function to get current price for an article
CREATE OR REPLACE FUNCTION get_current_article_price(
    p_article_id UUID,
    p_check_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS DECIMAL(10,2) AS $$
DECLARE
    current_price DECIMAL(10,2);
    base_price DECIMAL(10,2);
    check_time_local TIME;
    check_date_local DATE;
    check_dow INTEGER;
BEGIN
    -- Get base price
    SELECT a.base_price INTO base_price
    FROM articles a
    WHERE a.id = p_article_id AND a.is_active = true;
    
    IF base_price IS NULL THEN
        RETURN NULL; -- Article not found
    END IF;
    
    -- Extract local time components
    check_time_local := p_check_time::TIME;
    check_date_local := p_check_time::DATE;
    check_dow := EXTRACT(DOW FROM p_check_time); -- 0=Sunday, 1=Monday, etc.
    -- Adjust to 1=Monday, 7=Sunday format
    check_dow := CASE WHEN check_dow = 0 THEN 7 ELSE check_dow END;
    
    -- Find matching pricing rule with highest priority
    SELECT ap.price INTO current_price
    FROM article_pricing ap
    WHERE ap.article_id = p_article_id
    AND ap.is_active = true
    AND (
        -- Time match (if specified)
        (ap.start_time IS NULL OR ap.end_time IS NULL) OR
        (ap.start_time <= check_time_local AND ap.end_time >= check_time_local)
    )
    AND (
        -- Date match (if specified)
        (ap.start_date IS NULL OR ap.end_date IS NULL) OR
        (ap.start_date <= check_date_local AND ap.end_date >= check_date_local)
    )
    AND (
        -- Day of week match (if specified)
        ap.days_of_week IS NULL OR
        check_dow = ANY(ap.days_of_week)
    )
    ORDER BY ap.priority DESC, ap.created_at DESC
    LIMIT 1;
    
    -- Return pricing rule price if found, otherwise base price
    RETURN COALESCE(current_price, base_price);
END;
$$ LANGUAGE plpgsql;

-- Function to get current pricing for all articles in a shop
CREATE OR REPLACE FUNCTION get_shop_current_pricing(
    p_shop_id UUID,
    p_check_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE(
    id UUID,
    pos_article_id VARCHAR,
    name VARCHAR,
    base_price DECIMAL(10,2),
    current_price DECIMAL(10,2),
    active_pricing_rule VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.pos_article_id,
        a.name,
        a.base_price,
        get_current_article_price(a.id, p_check_time) as current_price,
        (
            SELECT ap.name
            FROM article_pricing ap
            WHERE ap.article_id = a.id
            AND ap.is_active = true
            AND (
                (ap.start_time IS NULL OR ap.end_time IS NULL) OR
                (ap.start_time <= p_check_time::TIME AND ap.end_time >= p_check_time::TIME)
            )
            AND (
                (ap.start_date IS NULL OR ap.end_date IS NULL) OR
                (ap.start_date <= p_check_time::DATE AND ap.end_date >= p_check_time::DATE)
            )
            AND (
                ap.days_of_week IS NULL OR
                (CASE WHEN EXTRACT(DOW FROM p_check_time) = 0 THEN 7 ELSE EXTRACT(DOW FROM p_check_time) END) = ANY(ap.days_of_week)
            )
            ORDER BY ap.priority DESC, ap.created_at DESC
            LIMIT 1
        ) as active_pricing_rule
    FROM articles a
    WHERE a.shop_id = p_shop_id
    AND a.is_active = true
    ORDER BY a.name;
END;
$$ LANGUAGE plpgsql; 