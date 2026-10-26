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


-- ============================================================
-- Shop markup configuration
-- Each body shop sets their own rate card and markup rules.
-- Consumer price = shop cost run through this config.
-- Markup is never computed by the AI model — it lives here.
-- ============================================================

CREATE TABLE IF NOT EXISTS shop_markup_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id TEXT NOT NULL,             -- identifies the shop (auth/tenant later)
  shop_name TEXT,

  -- Base markup: applied to total_shop_cost
  markup_type TEXT NOT NULL DEFAULT 'percentage' CHECK (markup_type IN (
    'percentage',      -- consumer = shop_cost * (1 + rate)
    'flat_amount',     -- consumer = shop_cost + amount
    'tiered'           -- see tier rules in markup_rules JSONB
  )),
  markup_rate NUMERIC(6,4),          -- e.g. 0.30 = 30% over shop cost
  markup_amount NUMERIC(10,2),       -- flat dollar add-on if markup_type = flat_amount

  -- Tiered markup rules (only used when markup_type = 'tiered')
  -- Example: [{"min": 0, "max": 1000, "rate": 0.40}, {"min": 1000, "max": 5000, "rate": 0.30}, {"min": 5000, "max": null, "rate": 0.25}]
  markup_rules JSONB DEFAULT '[]'::jsonb,

  -- Optional per-category overrides (paint, labor, materials, other)
  category_overrides JSONB DEFAULT '[]'::jsonb,
  -- Example: [{"category": "paint", "markup_type": "percentage", "markup_rate": 0.50}]

  -- Labor rate card: shop's current hourly rates by category
  labor_rate_card JSONB DEFAULT '[]]::jsonb,
  -- Example: [{"category": "body", "rate": 75.00}, {"category": "paint", "rate": 85.00}, {"category": "mechanical", "rate": 110.00}]

  -- Material pricing references (paint supplier, part cost multipliers)
  material_pricing JSONB DEFAULT '[]]::jsonb,

  -- Validity window
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,          -- null = currently active
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  notes TEXT
);

-- One active config per shop at a time (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_markup_active
  ON shop_markup_config (shop_id)
  WHERE is_active = true AND effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_shop_markup_shop ON shop_markup_config (shop_id, effective_from);

DROP TRIGGER IF EXISTS trg_shop_markup_config_updated_at ON shop_markup_config;
CREATE TRIGGER trg_shop_markup_config_updated_at
  BEFORE UPDATE ON shop_markup_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE shop_markup_config IS
  'Per-shop rate card and markup rules. Consumer-facing price is derived from total_shop_cost using this config. Shops edit this over time; history is preserved via effective_from/effective_to windows. Markup is never part of the AI model output.';

-- Helper: resolve the active markup config for a shop
CREATE OR REPLACE FUNCTION get_active_markup_config(p_shop_id TEXT)
RETURNS shop_markup_config AS $$
  SELECT * FROM shop_markup_config
  WHERE shop_id = p_shop_id
    AND is_active = true
    AND effective_from <= now()
    AND (effective_to IS NULL OR effective_to > now())
  ORDER BY effective_from DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Helper: compute consumer price from shop cost using active config
-- Tiered rules are always sorted ascending by min before matching,
-- so entry order in markup_rules cannot produce a wrong bracket.
CREATE OR REPLACE FUNCTION compute_consumer_price(
  p_shop_id TEXT,
  p_shop_cost NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  cfg shop_markup_config;
  tier JSONB;
  result NUMERIC;
BEGIN
  cfg := get_active_markup_config(p_shop_id);
  IF cfg IS NULL THEN
    -- No config: return shop cost unchanged (no markup)
    RETURN p_shop_cost;
  END IF;

  IF cfg.markup_type = 'percentage' THEN
    result := p_shop_cost * (1 + COALESCE(cfg.markup_rate, 0));
  ELSIF cfg.markup_type = 'flat_amount' THEN
    result := p_shop_cost + COALESCE(cfg.markup_amount, 0);
  ELSIF cfg.markup_type = 'tiered' THEN
    result := p_shop_cost; -- default, overridden by matching tier
    FOR tier IN
      SELECT value
      FROM jsonb_array_elements(cfg.markup_rules) AS t(value)
      ORDER BY (value->>'min')::numeric ASC
    LOOP
      IF p_shop_cost >= (tier->>'min')::numeric
         AND (tier->>'max' IS NULL OR p_shop_cost < (tier->>'max')::numeric) THEN
        result := p_shop_cost * (1 + (tier->>'rate')::numeric);
        EXIT;
      END IF;
    END LOOP;
  ELSE
    result := p_shop_cost;
  END IF;

  RETURN round(result, 2);
END;
$$ LANGUAGE plpgsql STABLE;
