import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildExtractionPrompt } from "@/lib/prompts/extract";
import type { ImageExtraction } from "./@/lib/pipeline/types";

const MODEL_CANDIDATES = [
  "gemini-2.0-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro",
];

function stripDataUrl(b64: string): string {
  return b64.replace(/^data:image\/[^;]+;base64,/, "");
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
      // Strip accidental code fences
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
      const parsed = JSON.parse(cleaned) as ImageExtraction;
      if (!parsed.panels || !Array.isArray(parsed.panels)) {
        throw new Error("Extraction JSON missing panels array");
      }
      return parsed;
    } catch (err) {
      lastError = err as Error;
      continue;
    }
  }
  throw lastError ?? new Error("All extraction model attempts failed");
}