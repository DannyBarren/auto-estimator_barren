# Auto Estimator

AI-assisted collision damage estimator for auto body shops. Customers upload photos of dents and scratches, the system returns a preliminary repair cost range, and the shop books an in-person inspection through Calendly.

The core purpose is **lead qualification**, not replacing the estimator. The AI produces a shop-cost estimate; the shop's own markup rules convert that into what the customer sees. Every completed job feeds a reference database that makes future estimates cheaper and more accurate.

## Why this exists

Body shop estimates are expensive to produce because a technician has to physically look at the car before quoting. Most customers who call never book. This tool filters tire-kickers: a customer who sees a realistic range and still schedules is a warm lead.

It also gives shops a structured starting point. Instead of writing an estimate from zero, the estimator reviews an AI-generated breakdown anchored to similar past jobs.

## Architecture

```
Customer form (photos + vehicle details)
        |
        v
Client compresses images to base64 (max 1024px, JPEG 0.7)
        |
        v
POST /api/analyze
        |
        +---> [Retrieval] similar rows from reference_estimates (planned)
        |
        v
Gemini multimodal: senior collision estimator persona,
shop-cost breakdown only (materials, labor hours, rate, total).
No consumer price. No hourly rates stated.
        |
        v
compute_consumer_price(shop_id, total_shop_cost)
  -> shop_markup_config (percentage / flat / tiered)
        |
        v
UI: estimate text + consumer price + Calendly booking link
        |
        v
Background: upload photos to Supabase storage, insert lead row
```

### Key files

| File | Role |
| --- | --- |
| `app/page.tsx` | Customer-facing form: photo upload, VIN decode via NHTSA, vehicle fields, damage description. Client-side image compression. Renders the estimate and Calendly link. |
| `app/api/analyze/route.ts` | Server-side Gemini call. Builds the estimator prompt, tries model fallbacks (`gemini-2.0-flash`, `gemini-1.5-flash-latest`, `gemini-1.5-pro`) with a 12-second timeout each. Returns plain-text estimate. |
| `schema/reference_estimates.sql` | Supabase/Postgres schema: reference estimates table + shop markup config table + helper functions. |
| `schema/README.md` | Schema documentation and design rationale. |

### Environment variables

- `GEMINI_API_KEY` — server-only, never exposed to the client
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## What was added (and why)

### 1. Reference estimates schema (`schema/reference_estimates.sql`)

**Problem:** Gemini is a general image model. It has no access to a shop's labor rates, paint costs, parts pricing, or historical estimates. The same photo can produce different ranges on different runs. Ungrounded estimates erode trust fast.

**Solution:** A `reference_estimates` table where every row is one job — photos, vehicle, damage description, and the shop's *actual cost* to complete it. All matching fields (year, make, model, trim, paint type/color/code, damage location/type/severity) are nullable so partial records still match. Source tracking (`ai_estimate`, `shop_invoice`, `manual_entry`, `imported`, `hybrid`) plus a confidence score lets the engine prefer real invoices over AI guesses.

**Why shop cost, not customer price:** Consumer prices in this industry are markup on top of cost, and that markup varies wildly by shop, region, and job size. If the reference data stored customer prices, the grounding signal would be noise. Store cost; derive price separately.

**Future ML path:** An optional `embedding` column (pgvector) and `metadata` JSONB are ready for when volume justifies routing to a local model instead of paid API calls. The longer the system runs, the cheaper each estimate gets.

### 2. Shop markup config (`shop_markup_config` table)

**Problem:** The same damage photo should produce different consumer prices at different shops. Markup is shop policy, not model knowledge.

**Solution:** A per-shop config table with three markup types:

- `percentage` — consumer = shop cost × (1 + rate)
- `flat_amount` — consumer = shop cost + fixed dollars
- `tiered` — different rates by job size (e.g., 40% under $1k, 30% from $1k–$5k, 25% above $5k)

Plus category overrides (paint markup can differ from labor markup), a labor rate card in JSONB, material pricing references, and effective-date windows so shops can edit over time without losing history. A partial unique index enforces one active config per shop.

**Two SQL helpers:**

- `get_active_markup_config(shop_id)` — resolves the currently valid config
- `compute_consumer_price(shop_id, shop_cost)` — applies it and returns the rounded consumer price

The AI model never sees or outputs a consumer price. That boundary is load-bearing: it keeps the model honest about cost and keeps pricing logic auditable in the database.

### 3. Sort guard on tiered markup

The `compute_consumer_price` function sorts tier rules by `min` ascending before matching, regardless of the order they were entered. Without this, a shop entering tiers out of order could land in the wrong bracket and quote wrong.

## Design principles

1. **The AI estimates cost. The database prices it.** Separation of estimation from pricing means the model can be swapped, fine-tuned, or replaced by ML later without touching shop economics.
2. **Partial data is first-class.** Every matching column is nullable. The retrieval layer must degrade gracefully — year+make+model if present, make+model if not, damage location+type as a last resort.
3. **The flywheel is the moat.** AI estimates seed the table; converted leads become shop invoices; invoices raise confidence; higher confidence means fewer API calls and better anchors. Volume is the product.
4. **Human in the loop by design.** Output is labeled preliminary and non-binding. The shop estimator writes the official number. This is how commercial photo-estimate tools operate and it avoids liability.

## Roadmap

- [ ] Wire retrieval: on each `/api/analyze` call, query `reference_estimates` for similar rows and inject them into the Gemini prompt as few-shot examples
- [ ] Seed `shop_markup_config` with the pilot shop's real rate card before first production estimate
- [ ] Capture the validation loop: when a lead converts, prompt the shop for the final invoice and write it back as a `shop_invoice` row
- [ ] Structured output parsing (JSON mode) so cost fields are machine-readable instead of free text
- [ ] Rate limiting and auth on `/api/analyze`
- [ ] Replace the placeholder Calendly URL with a per-shop booking link
- [ ] ML routing: once ~50–100 high-confidence invoice rows exist, add a path that predicts `total_shop_cost` locally and falls back to Gemini only when confidence is low
- [ ] Multi-shop support: tenant isolation on `shop_id` across both tables

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Set the environment variables above before hitting the analyze endpoint.

Apply the schema to your Supabase project via the SQL editor:

```sql
\i schema/reference_estimates.sql
```

Or copy-paste `schema/reference_estimates.sql` directly. Enable the `vector` extension if you want the embedding column for future similarity search.

## Stack

- Next.js 16 (App Router)
- Google Gemini (multimodal)
- Supabase (Postgres + storage)
- Calendly (booking)
- NHTSA VIN decoder API
