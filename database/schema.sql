-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create POS providers table
CREATE TABLE IF NOT EXISTS pos_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR NOT NULL,
    description TEXT,
    api_key VARCHAR UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create shops table (now with approval workflow)
CREATE TABLE IF NOT EXISTS shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pos_provider_id UUID NOT NULL REFERENCES pos_providers(id) ON DELETE CASCADE,
    pos_shop_id VARCHAR, -- POS system's shop ID (set during sync)
    name VARCHAR NOT NULL,
    description TEXT,
    type VARCHAR,
    status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
    approved_by VARCHAR, -- Admin who approved the shop
    approved_at TIMESTAMP WITH TIME ZONE,
    pos_synced_at TIMESTAMP WITH TIME ZONE, -- Last sync with POS
    pos_sync_data JSONB, -- POS-specific data from sync
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pos_provider_id, pos_shop_id) -- Ensure unique shop ID per POS provider (when synced)
);

-- Create articles table (shop menu items)
CREATE TABLE IF NOT EXISTS articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    pos_article_id VARCHAR NOT NULL, -- POS system's article ID
    name VARCHAR NOT NULL,
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    description TEXT,
    type VARCHAR,
    tax_type VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(shop_id, pos_article_id) -- Ensure unique article ID per shop
);

-- Create loyalty programs table
CREATE TABLE IF NOT EXISTS loyalty_programs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    type VARCHAR NOT NULL CHECK (type IN ('points', 'stamps')),
    name VARCHAR NOT NULL,
    description TEXT,
    points_per_euro DECIMAL(5,2) CHECK (points_per_euro >= 0), -- For points programs
    stamps_required INTEGER CHECK (stamps_required > 0), -- For stamp programs
    reward_description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create coupons table
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    code VARCHAR UNIQUE NOT NULL,
    type VARCHAR NOT NULL CHECK (type IN ('percentage', 'fixed', 'free_item')),
    value DECIMAL(10,2) NOT NULL CHECK (value >= 0),
    description TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    usage_limit INTEGER CHECK (usage_limit > 0),
    used_count INTEGER DEFAULT 0 CHECK (used_count >= 0),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    pos_invoice_id VARCHAR NOT NULL, -- Invoice ID from POS (printed on receipt)
    total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
    items JSONB NOT NULL, -- Array of transaction items
    customer_id UUID, -- Optional customer tracking
    loyalty_points_awarded INTEGER CHECK (loyalty_points_awarded >= 0),
    loyalty_stamps_awarded INTEGER CHECK (loyalty_stamps_awarded >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(shop_id, pos_invoice_id) -- Ensure unique invoice ID per shop
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_pos_providers_api_key ON pos_providers(api_key);
CREATE INDEX IF NOT EXISTS idx_shops_pos_provider_id ON shops(pos_provider_id);
CREATE INDEX IF NOT EXISTS idx_shops_pos_shop_id ON shops(pos_shop_id);
CREATE INDEX IF NOT EXISTS idx_shops_status ON shops(status);
CREATE INDEX IF NOT EXISTS idx_articles_shop_id ON articles(shop_id);
CREATE INDEX IF NOT EXISTS idx_articles_pos_article_id ON articles(pos_article_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_programs_shop_id ON loyalty_programs(shop_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_programs_active ON loyalty_programs(shop_id, is_active);
CREATE INDEX IF NOT EXISTS idx_coupons_shop_id ON coupons(shop_id);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(shop_id, is_active);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_transactions_shop_id ON transactions(shop_id);
CREATE INDEX IF NOT EXISTS idx_transactions_pos_invoice_id ON transactions(pos_invoice_id);
CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_pos_providers_updated_at BEFORE UPDATE ON pos_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_shops_updated_at BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_loyalty_programs_updated_at BEFORE UPDATE ON loyalty_programs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_coupons_updated_at BEFORE UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert sample data for development
INSERT INTO pos_providers (name, description, api_key) VALUES 
('Elektronček POS', 'Primary POS integration partner', 'test-api-key-elektronček-pos-2024')
ON CONFLICT (api_key) DO NOTHING;

-- Insert sample shop (now pre-registered by Zvest admin)
DO $$
DECLARE
    provider_id UUID;
    shop_id UUID;
BEGIN
    SELECT id INTO provider_id FROM pos_providers WHERE api_key = 'test-api-key-elektronček-pos-2024';
    
    -- Shop is pre-registered by Zvest admin (without POS connection yet)
    INSERT INTO shops (pos_provider_id, name, description, type, status, approved_by, approved_at) VALUES 
    (provider_id, 'Test Coffee Shop', 'A sample coffee shop for testing', 'coffee', 'active', 'admin', NOW())
    ON CONFLICT DO NOTHING
    RETURNING id INTO shop_id;
    
    -- If shop was just inserted, add related data
    IF shop_id IS NOT NULL THEN
        -- Insert sample loyalty program
        INSERT INTO loyalty_programs (shop_id, type, name, description, points_per_euro, is_active) VALUES 
        (shop_id, 'points', 'Coffee Points', 'Earn 10 points per euro spent', 10.00, true);
        
        -- Insert sample coupon
        INSERT INTO coupons (shop_id, code, type, value, description, usage_limit) VALUES 
        (shop_id, 'WELCOME10', 'percentage', 10.00, '10% discount for new customers', 100);
    END IF;
END $$; 