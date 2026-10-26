import { NextRequest, NextResponse } from "next/server";
import { runEstimationPipeline } from "@/lib/pipeline/run";
import type { UserInput } from "@/lib/pipeline/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      base64Images,
      base64Image,
      make,
      model,
      year,
      trim,
      vin,
      damageLocation,
      damageType,
      areaSqIn,
      damageDescription,
      customerName,
      customerPhone,
    } = body;

    const photos: string[] = base64Images?.length
      ? base64Images
      : base64Image
        ? [base64Image]
        : [];

    if (photos.length === 0) {
      return NextResponse.json({ error: "At least one photo is required" }, { status: 400 });
    }
    if (!make || !model || !year) {
      return NextResponse.json(
        { error: "year, make, and model are required" },
        { status: 400 }
      );
    }
    if (!damageLocation || !damageType) {
      return NextResponse.json(
        { error: "damageLocation and damageType are required (user-entered)" },
        { status: 400 }
      );
    }

    const input: UserInput = {
      photos,
      year: String(year),
      make: String(make),
      model: String(model),
      trim: trim ? String(trim) : undefined,
      vin: vin ? String(vin) : undefined,
      damageLocation: String(damageLocation),
      damageType: String(damageType),
      areaSqIn: areaSqIn != null ? Number(areaSqIn) : undefined,
      damageDescription: damageDescription ? String(damageDescription) : undefined,
      customerName: customerName ? String(customerName) : undefined,
      customerPhone: customerPhone ? String(customerPhone) : undefined,
    };

    const trace = await runEstimationPipeline(input);

    return NextResponse.json({
      estimate: trace.shop_cost,
      consumerPrice: trace.markup?.consumer_price ?? null,
      markup: trace.markup,
      extraction: trace.extraction,
      referenceCount: trace.retrieved_rows.length,
      anchored: trace.shop_cost?.anchored_to_reference ?? false,
      errors: trace.errors,
    });
  } catch (err) {
    console.error("analyze route error:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Estimation failed" },
      { status: 500 }
    );
  }
}