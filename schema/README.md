# Reference Database Schema

## Purpose

Stores historical and generated estimates so the system can:

1. Start with AI API calls (Gemini or similar) for every request.
2. Retrieve similar past jobs and inject them into the prompt (RAG-style grounding).
3. Later train or route to an ML model once enough high-quality shop-cost data exists.
4. Prefer cheaper local/ML inference as data volume grows.

All matching columns are nullable. The retrieval layer must handle missing fields gracefully (e.g., match on year+make+model if available, fall back to make+model, or damage_location+damage_type, etc.).

## Key design choices

- **Shop cost, not customer price**: `materials_cost`, `labor_hours`, `labor_rate`, `labor_cost`, `total_shop_cost`. Customer-facing prices are optional and separate.
- **Nullable everywhere that can be missing**: vehicle details, paint, damage location/type, costs. The engine must work with partial rows.
- **Source tracking**: `source_type` distinguishes AI estimates, real shop invoices, manual entry, etc. Prefer higher-confidence shop invoices for grounding.
- **Images**: `photo_urls` array + `primary_photo_url` so image input can be linked.
- **Future ML**: `embedding` column (requires pgvector) and `metadata` JSONB for features. `confidence` can be used for filtering or weighting.
- **Fuzzy matching**: `pg_trgm` indexes on make/model for imperfect text.

## How the engine should use it (next steps)

1. On each new estimate request, query similar rows (same or similar vehicle + damage location/type).
2. If good matches exist, include them in the AI prompt as examples and/or use their cost numbers as anchors.
3. After a real shop invoice is received, insert or update a row with `source_type = 'shop_invoice'` and the actual materials/labor numbers.
4. Once volume is high enough, a separate ML path can predict `total_shop_cost` (or labor hours + materials) directly and the system can choose AI vs ML based on confidence or cost.

## Applying the schema

Run `reference_estimates.sql` against your Supabase project (SQL editor or migration). Enable the `vector` extension if you want the embedding column.

```sql
-- In Supabase SQL editor
\i schema/reference_estimates.sql
```

Or copy-paste the contents.
