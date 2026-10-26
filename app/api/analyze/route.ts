import { NextResponse } from "next/server";

export async function POST(req: Request) {
  console.log("----------------------------------------");
  console.log("[API] Received estimate request");

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[API Error] GEMINI_API_KEY missing from .env.local");
      return NextResponse.json(
        { error: "GEMINI_API_KEY is missing in .env.local" },
        { status: 500 }
      );
    }

    const { base64Images, base64Image, make, model, year, description, vin } = await req.json();

    // Handle single or array payload formats
    const imagesArray: string[] = base64Images && Array.isArray(base64Images) && base64Images.length > 0
      ? base64Images
      : base64Image ? [base64Image] : [];

    if (imagesArray.length === 0) {
      console.error("[API Error] No image payload received");
      return NextResponse.json(
        { error: "No image data provided for analysis." },
        { status: 400 }
      );
    }

    console.log(`[API Log] Processing ${imagesArray.length} image(s) for analysis.`);

    const cleanImages = imagesArray.map((img) => img.replace(/^data:image\/\w+;base64,/, ""));

    const promptText = `You are a senior, licensed collision estimator at a professional auto body shop.
Analyze the provided vehicle damage photo(s) with high precision based on industry standards. Account for aluminum body repair (common on modern trucks like Ford F-150s), panel repair/replacement, teardown/reassembly, color matching, and adjacent panel blending.

Vehicle Specs:
${vin ? `VIN: ${vin}` : ""}
Year: ${year}
Make: ${make}
Model: ${model}
Customer Description: ${description || "None provided"}

Provide a direct, realistic estimate breakdown:
1. Estimated Repair Cost Range in USD (Provide an accurate full-service body shop range with roughly a $500 spread, e.g., $1,850 - $2,350).
2. Summary of required parts, labor tasks, and refinishing steps.

CRITICAL INSTRUCTION: Do NOT include or state specific hourly labor rates or price-per-hour ($/hr) figures in your final response.
Keep answer professional, concise, and strictly under 100 words.`;

    // Map all uploaded images into Gemini parts payload
    const imageParts = cleanImages.map((b64) => ({
      inline_data: {
        mime_type: "image/jpeg",
        data: b64,
      },
    }));

    let candidateModels: string[] = [];
    try {
      const listModelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      const listResp = await fetch(listModelsUrl, { signal: AbortSignal.timeout(5000) });
      const listData = await listResp.json();

      if (listResp.ok && Array.isArray(listData.models)) {
        candidateModels = listData.models
          .filter((m: any) => 
            Array.isArray(m.supportedGenerationMethods) && 
            m.supportedGenerationMethods.includes("generateContent")
          )
          .map((m: any) => m.name.replace(/^models\//, ""));
      }
    } catch (e: any) {
      console.warn("[API Warning] ListModels lookup failed or timed out:", e?.message);
    }

    if (candidateModels.length === 0) {
      candidateModels = ["gemini-2.0-flash", "gemini-1.5-flash-latest", "gemini-1.5-pro"];
    }

    console.log("[API Log] Models available for your key:", candidateModels);

    let aiText: string | null = null;
    let lastError = "";

    for (const modelName of candidateModels) {
      console.log(`[API Log] Querying model: ${modelName}...`);

      try {
        const googleApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        const response = await fetch(googleApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(12000),
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: promptText },
                  ...imageParts,
                ],
              },
            ],
          }),
        });

        const aiData = await response.json();

        if (response.ok && aiData.candidates?.[0]?.content?.parts?.[0]?.text) {
          aiText = aiData.candidates[0].content.parts[0].text;
          console.log(`[API Success] Estimate generated via model: ${modelName}`);
          break;
        } else {
          lastError = aiData.error?.message || `HTTP status ${response.status}`;
          console.warn(`[API Warning] ${modelName} returned error: ${lastError}`);
        }
      } catch (err: any) {
        lastError = err.name === "TimeoutError" || err.name === "AbortError"
          ? `Connection timed out on ${modelName}`
          : err.message;
        console.warn(`[API Warning] ${modelName} network error: ${lastError}`);
      }
    }

    if (!aiText) {
      console.error(`[API Error] All candidate models failed. Last error: ${lastError}`);
      return NextResponse.json(
        { error: `Google AI Error: ${lastError}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ estimate: aiText });

  } catch (error: any) {
    console.error("[API Error] Server crash:", error?.message || error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}