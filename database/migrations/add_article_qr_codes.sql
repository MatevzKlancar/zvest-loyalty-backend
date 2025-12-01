-- Migration: Add support for external QR codes linked to articles
-- Description: Allows shops to import external QR codes (e.g., ski tickets) and pair them with articles
-- Date: 2025-11-29

-- Create article_qr_codes table
CREATE TABLE IF NOT EXISTS public.article_qr_codes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  qr_code varchar(255) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used')),
  used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

-- Add unique constraint on qr_code to prevent duplicates across the entire system
CREATE UNIQUE INDEX IF NOT EXISTS article_qr_codes_qr_code_unique ON public.article_qr_codes(qr_code);

-- Add index on shop_id for faster lookups
CREATE INDEX IF NOT EXISTS article_qr_codes_shop_id_idx ON public.article_qr_codes(shop_id);

-- Add index on article_id for faster lookups
CREATE INDEX IF NOT EXISTS article_qr_codes_article_id_idx ON public.article_qr_codes(article_id);

-- Add index on status for filtering
CREATE INDEX IF NOT EXISTS article_qr_codes_status_idx ON public.article_qr_codes(status);

-- Add composite index for common query pattern (shop_id + status)
CREATE INDEX IF NOT EXISTS article_qr_codes_shop_status_idx ON public.article_qr_codes(shop_id, status);

-- Add feature flag to shops table
ALTER TABLE public.shops
ADD COLUMN IF NOT EXISTS external_qr_codes_enabled boolean DEFAULT false;
