import { createClient } from "@supabase/supabase-js";
import type { ReferenceRow, UserInput } from "./@/lib/pipeline/types";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars not set");
  return createClient(url, key);
}

export async function retrieveReferenceRows(
  input: UserInput,
  limit = 5
): Promise<ReferenceRow[]> {
  const supabase = getSupabase();

  let query = supabase
    .from("reference_estimates")
    .select(
      "id, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, paint_type, paint_color, damage_location, damage_type, damage_severity, area_sq_in, materials_cost, labor_hours, labor_rate, labor_cost, refinish_cost, other_cost, total_shop_cost, source_type, confidence, notes"
    )
    .limit(limit * 3); // over-fetch for ranking

  // Fuzzy match make/model
  if (input.make) query = query.ilike("vehicle_make", `%${input.make}%`);
  if (input.model) query = query.ilike("vehicle_model", `%${input.model}%`);

  // Exact-ish match on damage fields
  if (input.damageLocation)
    query = query.ilike("damage_location", `%${input.damageLocation}%`);
  if (input.damageType) query = query.ilike("damage_type", `%${input.damageType}%`);

  // Year proximity: +/- 5 years
  if (input.year) {
    const y = parseInt(input.year, 10);
    if (!isNaN(y)) {
      query = query.gte("vehicle_year", y - 5).lte("vehicle_year", y + 5);
    }
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as ReferenceRow[];

  // Rank: prioritize source_type (shop_invoice first), then field overlap
  const sourceRank: Record<string, number> = {
    shop_invoice: 0,
    manual_entry: 1,
    ai_estimate: 2,
  };

  rows.sort((a, b) => {
    const sa = sourceRank[a.source_type ?? ""] ?? 3;
    const sb = sourceRank[b.source_type ?? ""] ?? 3;
    if (sa !== sb) return sa - sb;

    // Severity proximity
    const sevOrder = { minor: 0, moderate: 1, severe: 2 };
    const ia = sevOrder[(a.damage_severity as any) ?? "moderate"] ?? 1;
    const ib = sevOrder[(b.damage_severity as any) ?? "moderate"] ?? 1;

    // Year proximity
    const ya = input.year ? Math.abs((a.vehicle_year ?? 0) - parseInt(input.year, 10)) : 99;
    const yb = input.year ? Math.abs((b.vehicle_year ?? 0) - parseInt(input.year, 10)) : 99;

    return ia + ya * 0.1 - (ib + yb * 0.1);
  });

  return rows.slice(0, limit);
}

export async function getActiveMarkupConfig(shopId?: string) {
  const supabase = getSupabase();
  // shop_markup_config: pull the currently effective row
  let query = supabase
    .from("shop_markup_config")
    .select("*")
    .lte("effective_from", new Date().toISOString())
    .order("effective_from", { ascending: false })
    .limit(1);

  if (shopId) query = query.eq("shop_id", shopId);

  const { data, error } = await query;
  if (error) throw error;
  return data?.[0] ?? null;
}