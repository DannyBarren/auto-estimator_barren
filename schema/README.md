# Reference Database Schema

## Purpose

Stores historical and generated estimates so the system can:

1. Start with AI API calls (Gemini or similar) for every request.
2. Retrieve similar past jobs and inject them into the prompt (RAG-style grounding).
3. Later train or route to an ML model once enough high-quality shop-cost data exists.
4. Prefer cheaper local/ML inference as data volume grows.

All matching columns are nullable. The retrieval layer must handle missing fields gracefully (e.g., match on year+make+model if available, fall back to make+model, or damage_location+damage_type, etc.).

## Two-table design

### `reference_estimates` — the knowledge base

Grounding data. Every row is one job: photos, vehicle, damage, and the **shop's actual cost** to do it.

- **Shop cost, not customer price**: `materials_cost`, `labor_hours`, `labor_rate`, `labor_cost`, `other_cost`, `total_shop_cost`. Customer-facing prices are optional and separate.
- **Source tracking**: `source_type` distinguishes AI estimates, real shop invoices, manual entry, etc. Prefer higher-confidence shop invoices for grounding.
- **Images**: `photo_urls` array + `primary_photo_url` so image input can be linked.
- **Future ML**: `embedding` column (requires pgvector) and `metadata` JSONB. `confidence` for filtering/weighting.
- **Fuzzy matching**: `pg_trgm` indexes on make/model for imperfect text.

### `shop_markup_config` — the pricing layer

Each body shop configures how shop cost becomes consumer price. This is **not** part of the AI model's job — markup lives entirely in this table and the helper functions.

- **Per-shop**: `shop_id` + `shop_name`. One active config per shop enforced by partial unique index.
- **Markup types**: `percentage` (e.g. 30% over cost), `flat_amount` (add $X), or `tiered` (different rates by job size via `markup_rules` JSONB).
- **Category overrides**: paint, labor, materials, or other can carry their own markup via `category_overrides` JSONB.
- **Labor rate card**: `labor_rate_card` JSONB holds the shop's current hourly rates by category (body, paint, mechanical) so new estimates can use real rates instead of guessing.
- **History**: `effective_from` / `effective_to` windows preserve past configs. Shops edit over time without losing what was active when.
- **Helpers**: `get_active_markup_config(shop_id)` and `compute_consumer_price(shop_id, shop_cost)` resolve the right config and apply it.

## Flow

```
Damage photos + vehicle info
        |
        v
[Retrieval] similar reference_estimates rows (partial-field matching)
        |
        v
[Gemini] produces shop-cost breakdown (materials, labor hours, rate, total)
        |
        v
[compute_consumer_price] applies this shop's markup config
        |
        v
Consumer sees: shop cost breakdown (optional) + marked-up price + Calendly
```

The AI never sees or outputs a consumer price. It estimates what the job costs the shop. The markup table turns that into what the customer pays.

## How the engine should use it (next steps)

1. On each new estimate request, query similar rows (same or similar vehicle + damage location/type).
2. If good matches exist, include them in the AI prompt as examples and/or use their cost numbers as anchors.
3. After a real shop invoice is received, insert or update a row with `source_type = 'shop_invoice'` and the actual materials/labor numbers.
4. Once volume is high enough, a separate ML path can predict `total_shop_cost` (or labor hours + materials) directly and the system can choose AI vs ML based on confidence or cost.
5. Seed `shop_markup_config` with the pilot shop's rate card and markup before the first real estimate runs.

## Applying the schema

Run `reference_estimates.sql` against your Supabase project (SQL editor or migration). Enable the `vector` extension if you want the embedding column.

```sql
-- In Supabase SQL editor
\i schema/reference_estimates.sql
```

Or copy-paste the contents.
