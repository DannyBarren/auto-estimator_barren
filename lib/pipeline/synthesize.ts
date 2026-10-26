import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildSynthesisPrompt } from "@/lib/prompts/synthesize";
import type {
  ImageExtraction,
  ReferenceRow,
  ShopCostEstimate,
  UserInput,
} from "./@/lib/pipeline/types";

const MODEL_CANDIDATES = [
  "gemini-2.0-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro",
];

export async function synthesizeShopCost(params: {
  input: UserInput;
  extraction: ImageExtraction;
  referenceRows: ReferenceRow[];
  rateCard: Record<string, number> | null;
}): Promise<ShopCostEstimate> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const genAI = new GoogleGenerativeAI(apiKey);

  const refSummaries = params.referenceRows.map((r) => ({
    year: r.vehicle_year,
    make: r.vehicle_make,
    model: r.vehicle_model,
    location: r.damage_location,
    type: r.damage_type,
    severity: r.damage_severity,
    materials: r.materials_cost,
    laborHours: r.labor_hours,
    laborRate: r.labor_rate,
    refinish: r.refinish_cost,
    other: r.other_cost,
    total: r.total_shop_cost,
    source: r.source_type,
  }));

  const prompt = buildSynthesisPrompt({
    year: params.input.year,
    make: params.input.make,
    model: params.input.model,
    trim: params.input.trim,
    damageLocation: params.input.damageLocation,
    damageType: params.input.damageType,
    areaSqIn: params.input.areaSqIn,
    extractionJson: JSON.stringify(params.extraction),
    referenceRows: refSummaries,
    rateCard: params.rateCard,
  });

  let lastError: Error | null = null;
  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text = result response.text().trim();
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
      const parsed = JSON.parse(cleaned) as ShopCostEstimate;
      if (typeof parsed.total_shop_cost !== "number") {
        throw new Error("Synthesis JSON missing total_shop_cost");
      }
      return parsed;
    } catch (err) {
      lastError = err as Error;
      continue;
    }
  }
  throw lastError ?? new Error("All synthesis model attempts failed");
}