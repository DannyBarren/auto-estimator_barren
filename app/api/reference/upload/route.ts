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

const NUMERIC_FIELDS = new Set([
  "vehicle_year",
  "materials_cost",
  "labor_hours",
  "labor_rate",
  "labor_cost",
  "other_cost",
  "total_shop_cost",
  "estimated_customer_price",
  "final_invoice_total",
  "confidence",
]);

const TEXT_FIELDS = new Set([
  "source_type",
  "source_id",
  "vehicle_make",
  "vehicle_model",
  "vehicle_trim",
  "vehicle_body_style",
  "paint_type",
  "paint_color",
  "paint_code",
  "damage_location",
  "damage_type",
  "damage_severity",
  "damage_notes",
]);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(current.trim());
        current = "";
      } else if (ch === "\n") {
        row.push(current.trim());
        rows.push(row);
        row = [];
        current = "";
      } else if (ch !== "\r") {
        current += ch;
      }
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    rows.push(row);
  }
  return rows;
}

function toNumber(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No CSV file provided." }, { status: 400 });
    }

    const text = await file.text();
    const rows = parseCsv(text);

    if (rows.length < 2) {
      return NextResponse.json(
        { error: "CSV must include a header row and at least one data row." },
        { status: 400 }
      );
    }

    const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, "_"));
    const dataRows = rows.slice(1).filter((r) => r.some((cell) => cell.length > 0));

    const records: Record<string, unknown>[] = [];
    const errors: string[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const cells = dataRows[i];
      const record: Record<string, unknown> = {};
      let rowError: string | null = null;

      for (let j = 0; j < headers.length; j++) {
        const key = headers[j];
        const value = cells[j] ?? "";

        if (!TEXT_FIELDS.has(key) && !NUMERIC_FIELDS.has(key)) {
          continue; // skip unknown columns
        }

        if (key === "source_type") {
          const st = value || "manual_entry";
          if (!ALLOWED_SOURCE_TYPES.has(st)) {
            rowError = `Row ${i + 2}: invalid source_type "${st}".`;
            break;
          }
          record[key] = st;
        } else if (key === "vehicle_year") {
          const n = toNumber(value);
          record[key] = n !== null ? Math.round(n) : null;
        } else if (key === "confidence") {
          const n = toNumber(value);
          record[key] = n !== null ? Math.min(1, Math.max(0, n)) : null;
        } else if (TEXT_FIELDS.has(key)) {
          record[key] = value || null;
        } else if (NUMERIC_FIELDS.has(key)) {
          record[key] = toNumber(value);
        }
      }

      if (rowError) {
        errors.push(rowError);
        continue;
      }

      // Default source_type if missing
      if (!record.source_type) {
        record.source_type = "manual_entry";
      }

      // Skip rows with zero useful data
      const hasData = Object.entries(record).some(
        ([k, v]) => k !== "source_type" && v !== null && v !== ""
      );
      if (hasData) {
        records.push(record);
      }
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: "No valid data rows found.", details: errors },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("reference_estimates")
      .insert(records)
      .select("id");

    if (error) {
      return NextResponse.json(
        { error: `Database insert failed: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      inserted: data?.length ?? records.length,
      skipped: errors.length,
      errors: errors.slice(0, 10),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}