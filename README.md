# Auto Estimator

AI-assisted collision damage estimator for auto body shops. A customer provides minimal input (make, model, year), captures damage photos, and runs a LiDAR scan from their iPhone. The system returns a preliminary repair cost range grounded in the shop's own history, the shop validates and corrects each estimated service, and every correction makes the next estimate more accurate and cheaper to produce.

The core purpose is **lead qualification with a built-in learning loop** — not replacing the estimator. The AI produces a shop-cost estimate; the shop's markup rules convert it into what the customer sees; the shop's validation of each service line item is what trains the system over time.

## Why this exists

Body shop estimates are expensive to produce because a technician has to physically look at the car before quoting. Most customers who call never book. This tool filters tire-kickers: a customer who sees a realistic range and still schedules is a warm lead.

It also gives shops a structured starting point. Instead of writing an estimate from zero, the estimator reviews an AI-generated breakdown anchored to similar past jobs — measured, not guessed.

## The vision: scan, estimate, validate, learn

```
Minimal user input (make, model, year)
        |
        v
Two capture sessions on iPhone (LiDAR-equipped):
  1. Video pull-back: close-up damage → full car.
     Computer vision localizes damage on the vehicle across
     overlapping frames at multiple scales.
  2. LiDAR depth scan: finger placed on undamaged panel
     as scale anchor. Depth, length, width, volume computed
     from deviation map. No manual measuring.
        |
        v
Server receives: RGB frames + depth map + point cloud
+ user fields. Extraction stage consumes measured geometry
instead of asking the user for it.
        |
        v
Retrieval: compare new scan (measurements, images, vehicle)
against reference_estimates history — all prior LiDAR scans,
photos, and validated jobs. Rank by similarity + source
confidence (shop invoices above AI rows).
        |
        v
Synthesis: Gemini (or local ML when volume justifies)
produces shop-cost breakdown anchored to retrieved history.
Flags when nothing is close rather than hallucinating.
        |
        v
Markup: pure code. shop_markup_config converts shop cost
to consumer price. AI never sees consumer pricing.
        |
        v
Estimate validation (engineered in, not optional):
The shop reviews every service line the estimate produced
and confirms or corrects the cost for each one. Corrections
are first-class data — they write back as high-confidence
reference rows and become the strongest training signal.
        |
        v
Persistence: full trace stored — inputs, extraction,
retrieved row IDs, synthesis output, markup result,
validation corrections. The database of LiDAR measurements
+ images + validated costs is the moat.
        |
        v
Next job: same pipeline, but retrieval now has one more
real, validated data point. Accuracy compounds.
```

### What makes this different from existing tools

- **Dents.co** measures dent depth with LiDAR and generates reports for insurers. It is a measurement tool. This system measures *and* estimates, with shop-specific grounding and a validation loop.
- **Kinetic Vision / LumaScanner / CMT Scanner** are fixed imaging booths or drive-through rigs for high-volume operations. This runs on a phone the customer or shop already owns.
- **Photo-only AI estimators** (Gemini, generic damage apps) have no access to a shop's rates, paint costs, or history, and no way to learn from corrections. This one does both by design.

The SAE paper on mobile LiDAR accuracy for crashed vehicles (2025-01-8692) found software choice drove accuracy spread more than hardware — which is exactly why the depth engine implementation matters and why validation against real invoices is the trust mechanism.

## Architecture (web)

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
| `app/reference/page.tsx` | Shop-facing reference data UI: CSV upload + manual entry for `reference_estimates`. |
| `app/api/reference/upload/route.ts` | CSV parser: quoted fields, per-row validation, bulk insert. |
| `app/api/reference/manual/route.ts` | Single-record manual insert. |
| `schema/reference_estimates.sql` | Supabase/Postgres schema: reference estimates table + shop markup config table + helper functions. |
| `schema/README.md` | Schema documentation and design rationale. |
| `ios/` (lidar-concept branch) | SwiftUI + ARKit + Vision scaffolding: two-pass capture (video pull-back + LiDAR depth), finger scale anchor, depth/volume math, API client to POST scans to `/api/analyze`. |

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

### 4. Reference data UI (`/reference`)

Shops need to seed the reference database before the flywheel has anything to retrieve. Two paths: download a CSV template, fill it with historical jobs, upload for bulk import; or add records one at a time through a manual form covering every reference field. Both write to `reference_estimates` with appropriate `source_type`.

### 5. LiDAR concept shell (`ios/`, this branch)

**Problem:** Asking the user to manually enter damage depth, length, and area defeats the purpose of image-based technology. Measurement should come from the device.

**Solution:** A SwiftUI capture shell using ARKit and Apple Vision:

- **Pass 1 — video pull-back:** slow retreat from close-up damage to full vehicle. Overlapping frames at multiple scales let Vision track features and localize the damage on the car body without user input.
- **Pass 2 — LiDAR depth scan:** finger placed flat on an undamaged section near the damage acts as an absolute scale anchor (radius-to-mm conversion). ARKit scene depth + plane fitting produce depth, length, width, and volume from the deviation map.
- **On-device first:** Vision contour detection and ARKit depth run locally; only extracted frames and measured geometry go to the server.
- **API client:** POSTs the scan payload to the existing `/api/analyze` route so the web pipeline consumes measured geometry instead of raw photos alone.

Caveats called out in the code: plane fitting is a stub (needs RANSAC on reconstructed 3D points), the volume conversion is empirically tuned and needs calibration against real dents, and panel classification is deferred to the server-side Gemini extraction.

## Design principles

1. **The AI estimates cost. The database prices it.** Separation of estimation from pricing means the model can be swapped, fine-tuned, or replaced by ML later without touching shop economics.
2. **Partial data is first-class.** Every matching column is nullable. The retrieval layer must degrade gracefully — year+make+model if present, make+model if not, damage location+type as a last resort.
3. **The flywheel is the moat.** AI estimates seed the table; shop validations and converted leads become high-confidence rows; higher confidence means fewer API calls and better anchors. Volume is the product. The database of LiDAR measurements, images, and validated costs is what no competitor can copy overnight.
4. **Validation is engineered in, not bolted on.** Every service line in an estimate must be confirmed or corrected by the shop. Unvalidated AI output is a liability; validated output is training data.
5. **Measurement replaces manual entry.** LiDAR + computer vision collapse the form to make/model/year. The device is the instrument; the user is the reviewer.
6. **Cost compounds downward.** Every validated job raises the chance the next estimate resolves from retrieval or local ML instead of a paid Gemini call.

## Roadmap

- [ ] Wire retrieval: on each `/api/analyze` call, query `reference_estimates` for similar rows (including LiDAR measurement fields) and inject them into the Gemini prompt as few-shot examples
- [ ] Seed `shop_markup_config` with the pilot shop's real rate card before first production estimate
- [ ] **Estimate validation UI:** shop-facing screen where each estimated service line is confirmed or corrected, with corrections writing back as `shop_invoice`-grade reference rows
- [ ] Capture the validation loop: when a lead converts, prompt the shop for the final invoice and write it back as a `shop_invoice` row
- [ ] Structured output parsing (JSON mode) so cost fields are machine-readable instead of free text
- [ ] Rate limiting and auth on `/api/analyze`
- [ ] Replace the placeholder Calendly URL with a per-shop booking link
- [ ] ML routing: once ~50–100 high-confidence invoice rows exist, add a path that predicts `total_shop_cost` locally and falls back to Gemini only when confidence is low
- [ ] Multi-shop support: tenant isolation on `shop_id` across both tables
- [ ] LiDAR shell hardening: RANSAC plane fitting, calibrated volume conversion, real-dent accuracy testing against shop invoices
- [ ] Video pull-back localization: finish Vision-based damage localization across the multi-scale frame sequence
- [ ] Point cloud + RGB fusion on the server so extraction consumes both geometry and appearance

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

The iOS shell lives in `ios/` on this branch. Open `ios/AutoEstimator.xcodeproj` in Xcode on a LiDAR-equipped iPhone (12 Pro or newer) to run the capture flow.

## Stack

- Next.js 16 (App Router)
- Google Gemini (multimodal)
- Supabase (Postgres + storage)
- Calendly (booking)
- NHTSA VIN decoder API
- SwiftUI + ARKit + Vision (iOS LiDAR capture shell)