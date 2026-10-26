export function buildSynthesisPrompt(params: {
  year: string;
  make: string;
  model: string;
  trim?: string;
  damageLocation: string;
  damageType: string;
  areaSqIn?: number;
  extractionJson: string;
  referenceRows: Array<{
    year: number | null;
    make: string | null;
    model: string | null;
    location: string | null;
    type: string | null;
    severity: string | null;
    materials: number | null;
    laborHours: number | null;
    laborRate: number | null;
    refinish: number | null;
    other: number | null;
    total: number | null;
    source: string | null;
  }>;
  rateCard: Record<string, number> | null;
}): string {
  const {
    year,
    make,
    model,
    trim,
    damageLocation,
    damageType,
    areaSqIn,
    extractionJson,
    referenceRows,
    rateCard,
  } = params;

  const vehicleLine = [year, make, model, trim].filter(Boolean).join(" ");

  const refBlock = referenceRows.length
    ? referenceRows
        .map((r, i) => {
          const parts = [
            `${i + 1}.`,
            [r.year, r.make, r.model].filter(Boolean).join(" "),
            r.location ? `location: ${r.location}` : null,
            r.type ? `type: ${r.type}` : null,
            r.severity ? `severity: ${r.severity}` : null,
            r.materials != null ? `materials: ${r.materials}` : null,
            r.laborHours != null ? `labor_hrs: ${r.laborHours}` : null,
            r.laborRate != null ? `labor_rate: ${r.laborRate}` : null,
            r.refinish != null ? `refinish: ${r.refinish}` : null,
            r.other != null ? `other: ${r.other}` : null,
            r.total != null ? `total_shop_cost: ${r.total}` : null,
            r.source ? `source: ${r.source}` : null,
          ].filter(Boolean);
          return parts.join(" | ");
        })
        .join("\n")
    : "(no matching reference rows found)";

  const rateBlock = rateCard
    ? Object.entries(rateCard)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "(no rate card on file)";

  return `You are a collision estimator. Produce a SHOP-COST estimate only. Never state a consumer price, markup percentage, or customer-facing total.

Vehicle: ${vehicleLine}
User-entered: location=${damageLocation}, damage_type=${damageType}${areaSqIn != null ? `, area_sq_in=${areaSqIn}` : ""}
Image extraction (JSON): ${extractionJson}

Reference jobs (shop cost, most similar first):
${refBlock}

Shop rate card: ${rateBlock}

Instructions:
- Anchor materials and labor hours to the closest reference rows. Adjust proportionally for panel count and severity differences.
- If no reference row is close in location, type, or vehicle class, say so in notes and give a wider range.
- Labor rate should come from the rate card when present; otherwise use the rate implied by reference rows.
- Output JSON only, no markdown: {"materials_cost": number, "labor_hours": number, "labor_rate_assumed": number, "refinish_cost": number, "other_cost": number, "total_shop_cost": number, "confidence": number 0-1, "notes": string, "anchored_to_reference": boolean}`;
}