import type {
  ImageExtraction,
  PipelineTrace,
  ShopCostEstimate,
  UserInput,
} from "./@/lib/pipeline/types";
import {
  extractDamageFromImages,
  getMissingRequiredFields,
  resolveRequiredFields,
} from "./@/lib/pipeline/extract";
import { retrieveReferenceRows, getActiveMarkupConfig } from "./@/lib/pipeline/retrieve";
import { synthesizeShopCost } from "./@/lib/pipeline/synthesize";
import { applyMarkup } from "./@/lib/pipeline/markup";
import { persistTrace } from "./@/lib/pipeline/persist";

export async function runEstimationPipeline(
  input: UserInput
): Promise<PipelineTrace> {
  const trace: PipelineTrace = {
    user_input: input,
    extraction: null,
    retrieved_rows: [],
    shop_cost: null,
    markup: null,
    model_used: null,
    errors: [],
    field_resolution: null,
    missing_required_fields: [],
    requires_user_input: false,
  };

  // Stage 2: Image extraction (perception layer)
  try {
    trace.extraction = await extractDamageFromImages(input.photos);
  } catch (err) {
    trace.errors.push(`extraction: ${(err as Error).message}`);
  }

  // Fallback hierarchy: sensor -> image -> user -> missing
  const { fields, resolution } = resolveRequiredFields(input, trace.extraction);
  trace.field_resolution = resolution;
  trace.missing_required_fields = getMissingRequiredFields(resolution);
  trace.requires_user_input = trace.missing_required_fields.length > 0;

  // If required fields are missing, stop before retrieval/synthesis.
  // The UI should prompt the user for exactly the missing fields and re-run.
  if (trace.requires_user_input) {
    trace.errors.push(
      `missing required fields: ${trace.missing_required_fields.join(", ")}`
    );
    await persistTrace(trace);
    return trace;
  }

  // Stage 3: Retrieval (reference rows + markup config in parallel)
  let markupConfig: any = null;
  try {
    const [rows, config] = await Promise.all([
      retrieveReferenceRows(input),
      getActiveMarkupConfig(),
    ]);
    trace.retrieved_rows = rows;
    markupConfig = config;
  } catch (err) {
    trace.errors.push(`retrieval: ${(err as Error).message}`);
  }

  // Stage 4: Synthesis
  try {
    const rateCard = markupConfig?.labor_rate_card ?? null;
    trace.shop_cost = await synthesizeShopCost({
      input,
      extraction: trace.extraction,
      referenceRows: trace.retrieved_rows,
      rateCard,
      resolvedFields: fields,
    });
    trace.model_used = "gemini-pipeline";
  } catch (err) {
    trace.errors.push(`synthesis: ${(err as Error).message}`);
  }

  // Stage 5: Markup
  if (trace.shop_cost) {
    const result = applyMarkup(trace.shop_cost.total_shop_cost, markupConfig);
    trace.markup = {
      shop_cost: trace.shop_cost.total_shop_cost,
      consumer_price: result.consumer_price,
      markup_type: result.markup_type,
      applied_rate: result.applied_rate,
    };
  }

  // Stage 6: Persist trace (non-blocking intent, but awaited for the ID)
  await persistTrace(trace);

  return trace;
}