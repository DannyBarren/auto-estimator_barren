import type {
  ImageExtraction,
  PipelineTrace,
  ShopCostEstimate,
  UserInput,
} from "./@/lib/pipeline/types";
import { extractDamageFromImages } from "./@/lib/pipeline/extract";
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
  };

  // Stage 2: Image extraction
  try {
    trace.extraction = await extractDamageFromImages(input.photos);
  } catch (err) {
    trace.errors.push(`extraction: ${(err as Error).message}`);
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
  if (trace.extraction) {
    try {
      const rateCard = markupConfig?.labor_rate_card ?? null;
      trace.shop_cost = await synthesizeShopCost({
        input,
        extraction: trace.extraction,
        referenceRows: trace.retrieved_rows,
        rateCard,
      });
      trace.model_used = "gemini-pipeline";
    } catch (err) {
      trace.errors.push(`synthesis: ${(err as Error).message}`);
    }
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