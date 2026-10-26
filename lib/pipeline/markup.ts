export function applyMarkup(
  shopCost: number,
  config: {
    markup_type: string | null;
    flat_percentage: number | null;
    flat_amount: number | null;
    tiered_rules: Array<{ min: number; max: number | null; rate: number; type: string }>;
  } | null
): { consumer_price: number; applied_rate: number | null; markup_type: string } {
  if (!config) {
    // Safe default: 30% markup
    return { consumer_price: shopCost * 1.3, applied_rate: 0.3, markup_type: "default_30pct" };
  }

  if (config.markup_type === "percentage" && config.flat_percentage != null) {
    const price = shopCost * (1 + config.flat_percentage / 100);
    return { consumer_price: price, applied_rate: config.flat_percentage, markup_type: "percentage" };
  }

  if (config.markup_type === "flat" && config.flat_amount != null) {
    return { consumer_price: shopCost + config.flat_amount, applied_rate: config.flat_amount, markup_type: "flat" };
  }

  if (config.markup_type === "tiered" && config.tiered_rules?.length) {
    // Sort guard: ascending by min
    const sorted = [...config.tiered_rules].sort((a, b) => a.min - b.min);
    for (const tier of sorted) {
      if (shopCost >= tier.min && (tier.max == null || shopCost <= tier.max)) {
        const price = tier.type === "percentage" ? shopCost * (1 + tier.rate / 100) : shopCost + tier.rate;
        return { consumer_price: price, applied_rate: tier.rate, markup_type: "tiered" };
      }
    }
    // Above all tiers: use top tier
    const top = sorted[sorted.length - 1];
    const price = top.type === "percentage" ? shopCost * (1 + top.rate / 100) : shopCost + top.rate;
    return { consumer_price: price, applied_rate: top.rate, markup_type: "tiered_top" };
  }

  return { consumer_price: shopCost * 1.3, applied_rate: 0.3, markup_type: "default_30pct" };
}