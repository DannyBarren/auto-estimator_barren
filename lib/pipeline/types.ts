export type DamageType = "dent" | "scratch" | "crease" | "puncture" | "scrape";
export type Severity = "minor" | "moderate" | "severe";
export type Panel = string;

export interface ImageExtraction {
  panels: Array<{
    panel: Panel;
    damage_type: DamageType;
    severity: Severity;
    paint_intact: boolean;
  }>;
  secondary_damage: string[];
  overall_severity: Severity;
  confidence: number;
}

export interface UserInput {
  photos: string[]; // base64 data URLs
  year: string;
  make: string;
  model: string;
  trim?: string;
  vin?: string;
  damageLocation: string; // user-entered, e.g. "front bumper"
  damageType: DamageType; // user-entered
  areaSqIn?: number; // user-entered approximate area
  damageDescription?: string;
  customerName?: string;
  customerPhone?: string;
}

export interface ReferenceRow {
  id: string;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_trim: string | null;
  paint_type: string | null;
  paint_color: string | null;
  damage_location: string | null;
  damage_type: string | null;
  damage_severity: string | null;
  area_sq_in: number | null;
  materials_cost: number | null;
  labor_hours: number | null;
  labor_rate: number | null;
  labor_cost: number | null;
  refinish_cost: number | null;
  other_cost: number | null;
  total_shop_cost: number | null;
  source_type: string | null;
  confidence: number | null;
  notes: string | null;
}

export interface ShopCostEstimate {
  materials_cost: number;
  labor_hours: number;
  labor_rate_assumed: number;
  refinish_cost: number;
  other_cost: number;
  total_shop_cost: number;
  confidence: number;
  notes: string;
  anchored_to_reference: boolean;
}

export interface MarkupResult {
  shop_cost: number;
  consumer_price: number;
  markup_type: string;
  applied_rate: number | null;
}

export interface PipelineTrace {
  user_input: UserInput;
  extraction: ImageExtraction | null;
  retrieved_rows: ReferenceRow[];
  shop_cost: ShopCostEstimate | null;
  markup: MarkupResult | null;
  model_used: string | null;
  errors: string[];
}