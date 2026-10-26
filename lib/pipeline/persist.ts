import { createClient } from "@supabase/supabase-js";
import type { PipelineTrace } from "./@/lib/pipeline/types";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key);
}

/**
 * Persist the full pipeline trace as a new reference_estimates row (source_type: ai_estimate).
 * This is the flywheel: every run becomes future retrieval fuel.
 */
export async function persistTrace(trace: PipelineTrace): Promise<string | null> {
  try {
    const supabase = getSupabase();

    const row = {
      vehicle_year: trace.user_input.year ? parseInt(trace.user_input.year, 10) : null,
      vehicle_make: trace.user_input.make || null,
      vehicle_model: trace.user_input.model || null,
      vehicle_trim: trace.user_input.trim || null,
      damage_location: trace.user_input.damageLocation || null,
      damage_type: trace.user_input.damageType || null,
      damage_severity: trace.extraction?.overall_severity ?? null,
      area_sq_in: trace.user_input.areaSqIn ?? null,
      materials_cost: trace.shop_cost?.materials_cost ?? null,
      labor_hours: trace.shop_cost?.labor_hours ?? null,
      labor_rate: trace.shop_cost?.labor_rate_assumed ?? null,
      refinish_cost: trace.shop_cost?.refinish_cost ?? null,
      other_cost: trace.shop_cost?.other_cost ?? null,
      total_shop_cost: trace.shop_cost?.total_shop_cost ?? null,
      source_type: "ai_estimate",
      confidence: trace.shop_cost?.confidence ?? null,
      notes: JSON.stringify({
        extraction: trace.extraction,
        retrieved_row_ids: trace.retrieved_rows.map((r) => r.id),
        markup: trace.markup,
        model_used: trace.model_used,
        errors: trace.errors,
      }),
    };

    const { data, error } = await supabase
      .from("reference_estimates")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.error("persistTrace error:", error);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("persistTrace failed:", err);
    return null;
  }
}