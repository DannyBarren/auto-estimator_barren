export type DamageType = "dent" | "scratch" | "crease" | "puncture" | "scrape";
export type Severity = "minor" | "moderate" | "severe";
export type Panel = string;

/** How a required field was resolved: sensor (LiDAR), image (CV/Gemini), user (manual entry), or missing. */
export type FieldSource = "sensor" | "image" | "user" | "missing";

/**
 * Non-negotiable fields for every estimation job.
 * Location + dimensions must come from LiDAR/video when possible;
 * paint type is the most likely fallback-to-user candidate.
 */
export interface RequiredFields {
  make: string;
  model: string;
  year: string;
  paint_color: string | null;
  paint_type: string | null; // matte, gloss, metallic, wrap, unknown
  damage_location: string; // e.g. "front bumper", "driver door"
  damage_type: DamageType;
  depth_mm: number | null;
  length_mm: number | null;
  width_mm: number | null;
  area_sq_in: number | null;
}

/** Per-field resolution tracking for the fallback hierarchy. */
export type FieldResolution = Record<string, FieldSource>;

export interface LidarScanData {
  depth_mm: number | null;
  length_mm: number | null;
  width_mm: number | null;
  volume_mm3: number | null;
  finger_anchor_mm: number | null; // scale reference used
  plane_fit_confidence: number | null;
  point_cloud_url: string | null; // Supabase storage path if uploaded
}

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
  // Dimension estimates from multi-scale video frames (rough, pixels-to-mm via context)
  estimated_depth_mm: number | null;
  estimated_length_mm: number | null;
  estimated_width_mm: number | null;
  estimated_area_sq_in: number | null;
  paint_type_guess: string | null; // matte/gloss/metallic/wrap if visible
  paint_color_guess: string | null;
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
  // LiDAR pass output from the iOS shell (optional until shell is wired)
  lidar?: LidarScanData;
  // Video pull-back frames (optional; may overlap with photos)
  videoFrames?: string[];
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
  // Fallback hierarchy results
  field_resolution: FieldResolution | null;
  missing_required_fields: string[];
  requires_user_input: boolean;
}