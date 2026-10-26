-- Reference estimates schema for auto-estimator
-- Designed for Supabase / Postgres
-- - All matching fields are nullable so the engine can operate on partial data
-- - Supports AI API estimates initially, then hybrid / pure ML once volume is sufficient
-- - Cost fields target shop cost (materials + labor), not customer-facing price

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for fuzzy text matching on make/model/color

-- Core reference table
CREATE TABLE IF NOT EXISTS reference_estimates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Source / provenance
  source_type TEXT NOT NULL CHECK (source_type IN (
    'ai_estimate',
    'shop_invoice',
    'manual_entry',
    'imported',
    'hybrid'
  )),
  source_id TEXT,                    -- external id if any
  confidence NUMERIC(4,3),           -- 0.000 - 1.000, how reliable this row is
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Vehicle identity (all nullable)
  vehicle_year SMALLINT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_trim TEXT,
  vehicle_body_style TEXT,           -- sedan, truck, suv, etc.
  vin TEXT,

  -- Paint / finish (nullable)
  paint_type TEXT,                   -- solid, metallic, pearl, matte, satin, wrap, clear_only, etc.
  paint_color TEXT,
  paint_code TEXT,                   -- OEM code if known

  -- Damage description (nullable / multi-value friendly)
  damage_location TEXT,              -- e.g. "front bumper", "driver door", "hood", "quarter panel"
  damage_type TEXT,                  -- dent, scratch, crease, crack, hail, paint_transfer, etc.
  damage_severity TEXT,              -- minor, moderate, severe
  damage_notes TEXT,

  -- Cost breakdown (shop cost basis, not customer price)
  materials_cost NUMERIC(10,2),
  labor_hours NUMERIC(6,2),
  labor_rate NUMERIC(8,2),           -- shop's rate at time of estimate
  labor_cost NUMERIC(10,2),
  other_cost NUMERIC(10,2),          -- blending, teardown, ADAS, etc.
  total_shop_cost NUMERIC(10,2),

  -- Optional customer-facing or final numbers for validation later
  estimated_customer_price NUMERIC(10,2),
  final_invoice_total NUMERIC(10,2),

  -- Image references (stored elsewhere, e.g. Supabase storage)
  photo_urls TEXT[],                 -- array of public or signed URLs
  primary_photo_url TEXT,

  -- Free-form extras and future ML features
  metadata JSONB DEFAULT '{}'::jsonb,
  embedding VECTOR(1536),            -- optional, for similarity search later (pgvector)

  -- Soft delete / active flag
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Indexes for flexible matching (all fields optional)
CREATE INDEX IF NOT EXISTS idx_ref_est_vehicle ON reference_estimates (vehicle_year, vehicle_make, vehicle_model);
CREATE INDEX IF NOT EXISTS idx_ref_est_make_model ON reference_estimates USING gin ((vehicle_make || ' ' || vehicle_model) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ref_est_damage ON reference_estimates (damage_location, damage_type);
CREATE INDEX IF NOT EXISTS idx_ref_est_paint ON reference_estimates (paint_type, paint_color);
CREATE INDEX IF NOT EXISTS idx_ref_est_source ON reference_estimates (source_type, created_at);
CREATE INDEX IF NOT EXISTS idx_ref_est_active ON reference_estimates (is_active) WHERE is_active = true;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reference_estimates_updated_at ON reference_estimates;
CREATE TRIGGER trg_reference_estimates_updated_at
  BEFORE UPDATE ON reference_estimates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Optional: view for active reference rows only
CREATE OR REPLACE VIEW active_reference_estimates AS
SELECT * FROM reference_estimates WHERE is_active = true;

COMMENT ON TABLE reference_estimates IS
  'Reference estimates for grounding AI and later ML. All matching fields nullable so partial data still usable. Costs represent shop cost (materials + labor), not customer price.';
