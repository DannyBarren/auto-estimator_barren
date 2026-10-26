import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildExtractionPrompt } from "@/lib/prompts/extract";
import type {
  FieldResolution,
  FieldSource,
  ImageExtraction,
  LidarScanData,
  RequiredFields,
  UserInput,
} from "./@/lib/pipeline/types";

const MODEL_CANDIDATES = [
  "gemini-2.0-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro",
];

/** Fields that must be present on every job before synthesis runs. */
export const REQUIRED_FIELD_KEYS = [
  "make",
  "model",
  "year",
  "paint_color",
  "paint_type",
  "damage_location",
  "damage_type",
  "depth_mm",
  "length_mm",
] as const;

export type RequiredFieldKey = (typeof REQUIRED_FIELD_KEYS)[number];

function stripDataUrl(b64: string): string {
  return b64.replace(/^data:image\/[^;]+;base64,/, "");
}

/**
 * Fallback hierarchy per required field:
 *   1. sensor  — LiDAR scan data (depth, length, width, volume)
 *   2. image   — Gemini extraction from photos / video frames
 *   3. user    — manual entry on the form
 *   4. missing — nothing resolved it; UI must prompt
 *
 * Vehicle identity (make/model/year) comes from user input only.
 * Paint type is expected to frequently land on user.
 */
export function resolveRequiredFields(
  input: UserInput,
  extraction: ImageExtraction | null
): { fields: RequiredFields; resolution: FieldResolution } {
  const lidar: LidarScanData | undefined = input.lidar;
  const resolution: FieldResolution = {};

  const pick = <T,>(
    key: string,
    sensorVal: T | null | undefined,
    imageVal: T | null | undefined,
    userVal: T | null | undefined
  ): T | null => {
    if (sensorVal != null) {
      resolution[key] = "sensor";
      return sensorVal;
    }
    if (imageVal != null) {
      resolution[key] = "image";
      return imageVal;
    }
    if (userVal != null) {
      resolution[key] = "user";
      return userVal;
    }
    resolution[key] = "missing";
    return null;
  };

  // Vehicle identity: user input only (no sensor or image source)
  const make = input.make?.trim() || null;
  resolution.make = make ? "user" : "missing";
  const model = input.model?.trim() || null;
  resolution.model = model ? "user" : "missing";
  const year = input.year?.trim() || null;
  resolution.year = year ? "user" : "missing";

  const fields: RequiredFields = {
    make: make ?? "",
    model: model ?? "",
    year: year ?? "",
    paint_color: pick(
      "paint_color",
      null,
      extraction?.paint_color_guess,
      null
    ),
    paint_type: pick(
      "paint_type",
      null,
      extraction?.paint_type_guess,
      null
    ),
    damage_location: pick(
      "damage_location",
      null,
      extraction?.panels?.[0]?.panel ?? null,
      input.damageLocation
    ) ?? "",
    damage_type: pick(
      "damage_type",
      null,
      extraction?.panels?.[0]?.damage_type ?? null,
      input.damageType
    ) ?? ("dent" as const),
    depth_mm: pick(
      "depth_mm",
      lidar?.depth_mm,
      extraction?.estimated_depth_mm,
      null
    ),
    length_mm: pick(
      "length_mm",
      lidar?.length_mm,
      extraction?.estimated_length_mm,
      null
    ),
    width_mm: pick(
      "width_mm",
      lidar?.width_mm,
      extraction?.estimated_width_mm,
      null
    ),
    area_sq_in: pick(
      "area_sq_in",
      null,
      extraction?.estimated_area_sq_in,
      input.areaSqIn
    ),
  };

  // Ensure resolution entries exist for width/area even when all null
  if (!resolution.width_mm) resolution.width_mm = "missing";
  if (!resolution.area_sq_in) resolution.area_sq_in = "missing";

  return { fields, resolution };
}

export function getMissingRequiredFields(
  resolution: FieldResolution
): string[] {
  return REQUIRED_FIELD_KEYS.filter((key) => resolution[key] === "missing");
}

export async function extractDamageFromImages(
  base64Images: string[]
): Promise<ImageExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const prompt = buildExtractionPrompt();

  const parts = [
    { text: prompt },
    ...base64Images.map((img) => ({
      inlineData: { mimeType: "image/jpeg", data: stripDataUrl(img) },
    })),
  ];

  let lastError: Error | null = null;
  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(parts);
      const text = result response.text().trim();
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
      const parsed = JSON.parse(cleaned) as ImageExtraction;
      if (!parsed.panels || !Array.isArray(parsed.panels)) {
        throw new Error("Extraction JSON missing panels array");
      }
      // Backfill optional dimension fields if the model omitted them
      return {
        estimated_depth_mm: parsed.estimated_depth_mm ?? null,
        estimated_length_mm: parsed.estimated_length_mm ?? null,
        estimated_width_mm: parsed.estimated_width_mm ?? null,
        estimated_area_sq_in: parsed.estimated_area_sq_in ?? null,
        paint_type_guess: parsed.paint_type_guess ?? null,
        paint_color_guess: parsed.paint_color_guess ?? null,
        ...parsed,
      };
    } catch (err) {
      lastError = err as Error;
      continue;
    }
  }
  throw lastError ?? new Error("All extraction model attempts failed");
}