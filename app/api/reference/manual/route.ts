import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);

const ALLOWED_SOURCE_TYPES = new Set([
  "ai_estimate",
  "shop_invoice",
  "manual_entry",
  "imported",
  "hybrid",
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const record: Record<string, unknown> = {
      source_type: body.source_type || "manual_entry",
      source_id: body.source_id || null,
      confidence: body.confidence != null ? Number(body.confidence) : null,
      vehicle_year: body.vehicle_year ? parseInt(body.vehicle_year) : null,
      vehicle_make: body.vehicle_make || null,
      vehicle_model: body.vehicle_model || null,
      vehicle_trim: body.vehicle_trim || null,
      vehicle_body_style: body.vehicle_body_style || null,
      paint_type: body.paint_type || null,
      paint_color: body.paint_color || null,
      paint_code: body.paint_code || null,
      damage_location: body.damage_location || null,
      damage_type: body.damage_type || null,
      damage_severity: body.damage_severity || null,
      damage_notes: body.damage_notes || null,
      materials_cost: body.materials_cost != null ? Number(body.materials_cost) : null,
      labor_hours: body.labor_hours != null ? Number(body.labor_hours) : null,
      labor_rate: body.labor_rate != null ? Number(body.labor_rate) : null,
      labor_cost: body.labor_cost != null ? Number(body.labor_cost) : null,
      other_cost: body.other_cost != null ? Number(body.other_cost) : null,
      total_shop_cost: body.total_shop_cost != null ? Number(body.total_shop_cost) : null,
      estimated_customer_price:
        body.estimated_customer_price != null
          ? Number(body.estimated_customer_price)
          : null,
      final_invoice_total:
        body.final_invoice_total != null ? Number(body.final_invoice_total) : null,
    };

    if (!ALLOWED_SOURCE_TYPES.has(record.source_type as string)) {
      return NextResponse.json(
        { error: `Invalid source_type: ${record.source_type}` },
        { status: 400 }
      );
    }

    // At minimum require some identifying info
    const hasIdentity = record.vehicle_make || record.vehicle_model || record.damage_location;
    if (!hasIdentity) {
      return NextResponse.json(
        {
          error:
            "At least one of vehicle make, model, or damage location is required.",
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("reference_estimates")
      .insert([record])
      .select("id")
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Insert failed: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}