# Webflow Cloud spike

**Status:** ready to deploy, results pending.
**Goal:** decide whether `next-webflow`'s default mode (Data API + Next data cache + webhook `revalidateTag`) works on Webflow Cloud, or whether Cloud needs an alternative mode.

App: `spikes/webflow-cloud/` (outside the pnpm workspace, npm, library installed from `vendor/next-webflow.tgz`).

## What the docs say (2026-10-20)

- Webflow Cloud runs Next.js on Cloudflare Workers through the OpenNext adapter, which Webflow installs and configures at build time. Apps can't configure the OpenNext incremental/tag cache.
- ISR and on-demand revalidation are documented as **experimental**. `use cache` is unsupported.
- Responses: `Cache-Control` is replaced with `private, no-cache` and `cache-tag` headers are removed. This is the HTTP/CDN layer; whether the **Next data cache** (fetch cache) persists is what this spike measures.
- Limits: 6 simultaneous outgoing requests, 1,000 subrequests per request, 20 s request timeout, 30 s CPU, 128 MB memory, 10 MB worker bundle.
- Next 16 logs "The Edge Runtime is deprecated" at build, while Webflow Cloud docs say API routes need `runtime = 'edge'`. The spike tests both runtimes.

## Deploying the spike (secrets!)

Secrets are uploaded to Webflow Cloud with `webflow apps env-vars import local.env --secret`, never deployed through `.env*` files of any mode (`.env`, `.env.local`, `.env.production`, `.env.development.local`, `.env.test`…), in the app directory or at the project root above it (the nearest parent folder with a lockfile, in a monorepo). The spike keeps its values in **`local.env`** (deploy vars) and **`seed.env`** (write token, local only), both git-ignored and never named `.env*`.

```bash
cp local.env.example local.env          # fill in: read-only token, site ID, SPIKE_SECRET
npm run deploy                          # refuses if any .env* file exists (app or project root), then `webflow apps deploy`
webflow apps env-vars import local.env --secret --dry-run
webflow apps env-vars import local.env --secret
npm run deploy                          # redeploy so the app picks up the variables
```

First deploy (2026-10-21): app `next-webflow-spike`, environment `main`, mount `/spike` on `next-webflow-d8ce88.webflow.io`. A first attempt was stopped before upload when the bundled secrets were found.

## Working cache config (deploy `a779ed30`, 2026-10-21)

The config that made the data cache and `revalidateTag` work. Versions: Next.js 16.4.2, `@opennextjs/cloudflare` 1.20.12, Webflow CLI 2.13.0.

- **Incremental cache (fetch/data cache): Workers KV**, `kvIncrementalCache`, binding `NEXT_INC_CACHE_KV`.
- **Tag cache: D1**, `d1NextTagCache` (OpenNext "nextMode" tag cache), binding `NEXT_TAG_CACHE_D1`, table `revalidations`. It records when each tag was revalidated; a cached entry older than its tags' last revalidation is a miss. Not KV (`kvNextTagCache`) and not Durable Objects (not documented on Webflow Cloud).
- **Queue: none** (OpenNext default `dummy`). It's only needed for time-based ISR.

`spikes/webflow-cloud/open-next.config.ts`:

```ts
// Webflow Cloud generates `defineCloudflareConfig()` (dummy caches: no data cache, revalidateTag is a
// no-op) only when the app has no open-next.config.ts. This one backs the Next data cache with KV and
// the tag cache with D1, both provisioned by Webflow Cloud from the bindings in wrangler.json.
// No queue: it only serves time-based ISR, and Webflow Cloud doesn't document the service binding
// (WORKER_SELF_REFERENCE) or Durable Objects the queue overrides need.
// NOTE: the Webflow builder deletes this file after deploying; keep it committed (`npm run deploy`
// checks it exists).
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: d1NextTagCache,
});
```

`spikes/webflow-cloud/wrangler.json` (IDs are placeholders; Webflow Cloud provisions one KV namespace and one D1 database per environment and substitutes the real IDs):

```json
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "next-webflow-spike",
  "compatibility_date": "2025-03-03",
  "kv_namespaces": [{ "binding": "NEXT_INC_CACHE_KV", "id": "local" }],
  "d1_databases": [
    {
      "binding": "NEXT_TAG_CACHE_D1",
      "database_name": "next-tag-cache",
      "database_id": "0",
      "migrations_dir": "migrations"
    }
  ]
}
```

`spikes/webflow-cloud/migrations/0001_revalidations.sql` (applied by Webflow Cloud on every deploy):

```sql
-- Table OpenNext's D1 tag cache reads and writes (same DDL as `opennextjs-cloudflare populateCache`).
-- Webflow Cloud applies migrations_dir on every deploy.
CREATE TABLE IF NOT EXISTS revalidations (tag TEXT NOT NULL, revalidatedAt INTEGER NOT NULL, stale INTEGER, expire INTEGER default NULL, UNIQUE(tag) ON CONFLICT REPLACE);
```

## Open questions for v0.2

1. **Cache behavior after a redeploy (top priority).** OpenNext keys cache entries by build ID, so a redeploy should start cold: every page refetches from Webflow, which can spike API usage on large sites. To verify: are old KV entries orphaned (storage growth)? Does the D1 `revalidations` table survive (it should; same database)? How long until the cache is warm again?
2. Staleness across regions (KV is eventually consistent; one location measured).
3. Pagination with more than 6 pages of 100 items against the 6-connection limit (needs > 600 items).

## Questions and how they're measured

### 1. Does the Next data cache persist across requests?

Page `/probe` and routes `api/probe` (edge) / `api/probe-node` (node) do a `fetch(..., { cache: "force-cache", next: { tags: ["spike-probe"] } })` to `GET /v2/sites/{id}`. On a HIT the stored response comes back: its `date` and `x-ratelimit-remaining` headers stay frozen and `durationMs` is small. `isolate` identifies the Worker isolate: a HIT across different isolates means a shared cache; only within one isolate means in-memory only.

Measured 2026-10-21 (deploy `c3bf1486`), 12 requests from curl, 1 s apart:

| Runtime | HIT within an isolate? | HIT across isolates? | Survives a redeploy? | Notes |
| --- | --- | --- | --- | --- |
| page (node) | — | — | — | Not measured separately; same mechanism as the node route. |
| route (edge) | — | — | — | **Every request is a 500** (`x-opennext: 1`, plain "Internal Server Error"), even `api/revalidate` before checking the secret. |
| route (node) | **No** | **No** | — | Every request re-fetches: new `date`, `x-ratelimit-remaining` 149 → 144, also twice on the same isolate (`60646244`). 5 isolates in 6 requests. |

**Why:** the builder generates `open-next.config.ts` as `defineCloudflareConfig()` with no arguments, so OpenNext's `incrementalCache`, `tagCache` and `queue` are all `"dummy"`. There is no data cache, `force-cache` is a no-op, and `revalidateTag` has nothing to invalidate. The builder only generates that file when the app has none ("open-next.config not found, creating…"), and it keeps a user `wrangler.json` (`clouduser.wrangler.json`), so a KV-backed cache configured by the app may be possible (untested).

#### With a KV incremental cache + D1 tag cache (deploy `a779ed30`)

The app ships its own `open-next.config.ts` (`kvIncrementalCache` + `d1NextTagCache`, no queue), `wrangler.json` bindings (`NEXT_INC_CACHE_KV`, `NEXT_TAG_CACHE_D1`, placeholder IDs) and `migrations/0001_revalidations.sql` (the tag table; Webflow applies `migrations_dir` on deploy). Webflow Cloud documents D1, KV and R2, **not Durable Objects**, so the DO-based queue/tag cache are out. `npm run measure` (fresh tag per run):

| Measurement | Dummy caches (`c3bf1486`) | KV + D1 (`a779ed30`) |
| --- | --- | --- |
| Later requests returning the first response | 0/11 (9 isolates) | **11/11 (9 isolates)** |
| Probe duration on a HIT | — (every call 60–860 ms) | **16–40 ms** |
| Fresh data after `revalidateTag` (node route) | n/a | **~1 s** (first poll) |
| Stale data after the first fresh response | n/a | **None** (20/20 fresh, 10 isolates) |

Caveats: one run, from one client location (Worker placement `local-IAD`); KV is eventually consistent across locations, which this can't show, but invalidation is decided by the D1 tag table, so a stale KV entry is treated as a miss. Cache entries are keyed by build ID, so a redeploy starts cold. The CLI **deletes `open-next.config.ts` from the local working copy after each deploy**, but the deployed build used it (see below); `npm run deploy` refuses to run without it.

#### Does a deploy lose `open-next.config.ts`? (clarified 2026-10-21, CLI 2.13.0)

Only the local copy. From the CLI debug log of deploy `f0f22fc9`:

1. Build: `open-next.config.ts found, skipping creation (opennextjs-cloudflare will validate)`. The build uses the app's file.
2. After upload, "Revert framework configuration": `cleaning up additional config file …/open-next.config.ts`. The CLI deletes it locally, as if it had generated it.

`npm run measure` against that deploy: 11/11 HITs across 7 isolates, fresh 1.5 s after `revalidateTag`. So the deployed app keeps the KV + D1 cache. The risk is the **next** deploy from the same working copy: without the file, the CLI generates its default (dummy caches, §1), and caching silently stops. Deploys from a fresh checkout (CI) are safe. For users (v0.2 README): commit `open-next.config.ts`, deploy from CI or restore it before each local deploy (`git checkout -- open-next.config.ts`), and add a pre-deploy check like `scripts/check-no-env.mjs`. Upstream finding 10.

### 2. Does `revalidateTag` invalidate, and how fast?

| Revalidated from | Works? | Time until fresh | Errors |
| --- | --- | --- | --- |
| node route, dummy caches | No-op | — | — |
| node route, KV + D1 | **Yes** | ~1 s | — |
| edge route | — | — | 500 on every request |

### 3. Pagination vs the 6 concurrent requests limit

`/pagination?c=N` reads the collection with no cache. `?pageSize=1` uses small pages so a few items already give > 6 parallel pages (any site plan); `pageSize=100` is the real `getItems` (needs > 600 items, see `npm run seed`).

`?pageSize=1`, 9 live items → 9 pages, 8 in parallel after the first:

| Concurrency | Result | Duration | Notes |
| --- | --- | --- | --- |
| 2 | OK | 1406 ms | |
| 4 (default) | OK | 471 ms | |
| 6 | OK | 1221 ms | |
| 8 | OK | 360 ms | 8 parallel requests > 6: queued by Workers, no error |
| 12 | OK | 413 ms | |
| real `getItems` (100/page), c=4 | OK | 225 ms | 1 page |

Durations are noisy (single runs, cold isolates). Exceeding 6 concurrent requests didn't fail with 9 pages; a larger collection is needed to see whether queueing hits the 20 s limit.

### 4. Library on real data (`/library`)

| Check | Result |
| --- | --- |
| `getItems("posts")` without generated schema (API fallback + warning) | Not tested (deployed with a snapshot). |
| With `src/webflow-schema.ts` snapshot: no warnings | OK, no warnings. |
| After adding a new Option + item using it: warning, correct name via fallback | **OK** (KV + D1 deploy). Added `Tutorials` in the Designer, set it on `cms-trends-2023-5`, item-level "Publish now". `getItemBySlug` warned "generated schema for \"posts\" is out of date (unknown options in: category)" and returned `{ id, name: "Tutorials" }`. |
| Cached list + collection tag (the webhook flow) | **OK.** `getItems("posts")` kept serving the cached `News` after publishing; `revalidateTag("webflow:collection:<postsId>", { expire: 0 })` → `Tutorials` on the next read (~1 s), stable after. |
| `getItemBySlug` | OK (`?slug=cms-future-10`). |
| Base path: links and client fetches work under the mount path | OK (`/spike`, assets from `*.wf-app-prod.cosmic.webflow.services/spike`). |
| VideoLink normalization | **Old library deployed**: `package-lock.json` pinned the previous tarball's integrity and the builder's `npm ci` installed it from cache. `pack-lib` now refreshes the lock entry; redeploy pending. |
| `lastPublished` on live items | `null` right after the first site publish (contract test); non-null after a later site publish, and set to the publish time after an item-level publish (`2026-10-21T03:41:14Z`). Treat it as optional on live items. |

### 5. Webhooks end to end (stage 4, deploy with D1 webhook log, 2026-10-21)

Six signed webhooks registered with `npm run webhooks -- register` (every CMS event + `site_publish`) against `/spike/api/webflow` (the library's handler, plus a D1 log of every request). `npm run watch` polled the log and `/library` every 2 s. Actions in the CMS UI unless noted. All 11 Webflow deliveries signed and answered 200 (plus a manual unsigned request → 401).

| # | Action | Webhooks (in order) | Payload | Invalidated (mapping at the time) | Visible in `/library` |
| --- | --- | --- | --- | --- | --- |
| 1 | Edit name, save, don't publish | `changed` | flat, `isDraft: true`, `lastUpdated` > `lastPublished` | nothing | unchanged ✔ |
| 2 | "Publish now" on that item | `changed` (`isDraft: false`), `published` | `published`: **`items[]`** | collection + item | new name ~1.5 s after the webhook ✔ |
| 3 | Unpublish | `unpublished` | flat, `isDraft: false`, `lastPublished: null` | collection + item | gone ~1.5 s ✔ |
| 4 | Delete a published item | `deleted` | flat | collection + item | **still listed**: Webflow's live list kept it until the next site publish (10 min); gone 1.5 s after `site_publish` |
| 5 | Change slug + publish | `changed` (`isDraft: true`), `published`, `changed` | | collection + item | old slug → `null`, new slug resolves, ~1 s ✔ |
| 6 | Publish site | `site_publish` | `siteId, publishedOn, domains, publishedBy, publishSource` | `webflow` | ✔ |
| 7 | `PATCH /items/live` (API) | **only `changed`** | flat, `isDraft: false`, `lastPublished` = `lastUpdated` | nothing → **stale list** | stale until the next invalidation |

**Re-run with the new mapping** (deploy `f0f22fc9`, 2026-10-21, created/changed invalidate unless `isDraft === true`):

| # | Action | Webhooks (in order) | Payload | Invalidated | Visible in `/library` |
| --- | --- | --- | --- | --- | --- |
| 7b | `PATCH /items/live` (API), same as 7 | only `changed` | flat, `isDraft: false` | collection + item | new name 3 s after the PATCH, on its own ✔ |
| 8 | `POST /items/live` (API create, `npm run api-create-live`) | `created`, `published` (`items[]`) | `created`: `isDraft: false`, `lastPublished` = `lastUpdated` | collection + item (both events) | listed ~1.8 s after the POST ✔ |
| 9 | New item in the CMS, saved, not published | `created`, then `changed` ×2 (later saves) | `isDraft: true`, `lastPublished: null` | nothing | unchanged ✔ |

Deploying non-interactively needs the mount: `npx webflow apps deploy -a <appId> -e main -m /spike -s <siteId>`; the CLI still deletes the local `open-next.config.ts` (restore it from git after each deploy; the deployed build is unaffected).

Conclusions:
- Flags are `isArchived`/`isDraft`; `collection_item_published` uses `items[]`, every other item event a flat item (upstream finding 5).
- `isDraft` is `true` only while an item has staged changes. Mapping changed (2026-10-21): `created`/`changed` invalidate unless `isDraft === true` (fail-safe; timestamps are logged, never used), and `webhooks register` subscribes to every CMS event by default. Fixes case 7.
- Unlike edits, API creates also fire `published`; the new mapping is needed for API edits only, and harmless (double invalidation) for creates.
- Case 4 is a Webflow API inconsistency (upstream finding 8). README documents publishing the site after deletes.
- The Cloud app kept serving after site publishes. Raw payloads → `test/fixtures/api/webhooks/` (`publishedBy` anonymized).

### 6. Load test: pagination, builds and big webhooks (stage 5b, 2026-10-21, deploy `f7ebc670`)

**Constraint:** the test site is on the **Starter** plan: **50 CMS items** (and, on Cloud, 100K KV / 10M D1 simple operations a month). 600+ items need a paid plan, so the collection `load-test` (`6ad8fd8ec7f36839f0d31230`, kept for regression tests) has **35 items** (~2.4 KB each as JSON: rich text body, summary, number, Option, Reference). Many pages are simulated with small page sizes; numbers for 100-item pages are extrapolated and marked as such.

**Seeding** (`npm run seed -- 35`): one `POST /collections/{id}/items/insert` with 35 items, `isDraft: false` (queued for the next site publish; `isDraft: true` items are *not* published by a site publish since Dec 2024). The script refuses to exceed the plan limit (counts every collection). Webhooks: **35 × `collection_item_created`**, one per item, `isDraft: false` → our fail-safe mapping invalidates the collection tag 35 times (harmless: invalidation is lazy).

**Publishing:**

| Action | Webhooks | Notes |
| --- | --- | --- |
| Site publish via API (`POST /sites/{id}/publish`), 35 queued items | **only `site_publish`** | no `collection_item_published` at all; items live afterwards |
| `POST /collections/{id}/items/publish`, 35 IDs | 1 × `collection_item_published` with **`items[35]` (90 KB)** + 1 × `collection_item_changed` per item | first attempt answered **502** but had already fired 4 `changed`; the retry → 202 in 2.3 s |

So a big `items` array comes from API item publishes (max 100 IDs per request → ~250 KB), not from site publishes.

**Handler time vs the 20 s limit.** Inside the Worker the handler measured 0 ms: Workers' clock only advances on I/O, and `revalidateTag` defers its D1 writes. Measured from outside instead: the real 35-item body, resized and signed, replayed 3× each:

| Items in `items[]` | Body | Round trip (3 runs) | Tags revalidated |
| --- | --- | --- | --- |
| 1 | 3 KB | 841 / 511 / 442 ms | 2 |
| 35 | 88 KB | 932 / 777 / 640 ms | 36 |
| 100 | 252 KB | 1134 / 1605 / 911 ms | 101 |
| 600 | 1.5 MB | 2145 / 1277 / 2092 ms | 601 |

Far below 20 s. Not verified: that all 601 deferred tag writes land (no read access to D1 from outside besides the spike's own log).

**Cold `getItems` on Cloud** (`npm run measure-load`: revalidate the collection tag, wait 2 s, call `/api/measure-items`; concurrency 4 unless noted):

| Run | Requests | Total | Per request (p50) | Data | Rate limit used | CDN cache |
| --- | --- | --- | --- | --- | --- | --- |
| library `getItems`, data | 1 | 269 ms | 269 ms | 82 KB | 1 | – |
| library `getItems`, cdn | 1 | 491 ms | 491 ms | 82 KB | 0 (no headers) | MISS |
| 35 per page, data / cdn | 1 / 1 | 170 / 686 ms | | 82 KB | 1 / 0 | – / MISS |
| 10 per page, data / cdn | 4 / 4 | 576 / 1076 ms | 211 / 447 ms | 83 KB | 4 / 0 | – / MISS |
| 5 per page, data / cdn | 7 / 7 | 600 / 1037 ms | 111 / 359 ms | 83 KB | 7 / 0 | – / MISS |
| 1 per page, data / cdn | 35 / 35 | 3846 / 4020 ms | 107 / 332 ms | 84 KB | 35 / 0 | – / MISS |
| 1 per page, data, c=6 | 35 | 1735 ms | 108 ms | 84 KB | 35 | – |
| 1 per page, data, c=12 | 51 (16 × 429) | 15 711 ms | 179 ms | 86 KB | window exhausted | – |

- Data API: ~100–270 ms per page, roughly flat in page size up to 35 items. CDN misses are 2–3× slower and carry **no rate limit headers** (hits don't count, per the docs).
- More than 6 concurrent requests didn't fail (c=12); the 429s came from the **per-minute budget** (`X-RateLimit-Limit: 150`, already drained by the previous runs). The client honored `Retry-After` and finished.
- **Extrapolation (100 items per page, ~240 KB):** ~0.3–0.6 s per page; with concurrency 4, N pages ≈ ⌈N/4⌉ waves → 1,000 items (10 pages) ≈ 1–2 s and 10 requests; 5,000 items (50 pages) ≈ 4–8 s and 50 requests, a third of a 150/min budget (all of a 60/min Starter budget per the plan page).

**`generateStaticParams` build** (local `next build`, 10 workers, cold `.next`; a page per item calling `getItemBySlug`). On Webflow Cloud this runs in the CLI's **local** build:

| Source | Webflow requests | Build | Requests span | Per request | Rate limit used |
| --- | --- | --- | --- | --- | --- |
| data | 36 (1 list + 35 slug lookups) | 11 s | 5.4 s | 215–3523 ms | 35 (133 → 98) |
| cdn | 36 (all MISS) | 9 s | 3.7 s | 461–1137 ms | 0 (no headers) |

Each build worker has its own client (and limiter), so build concurrency is up to 10 × 4. A site with N items costs **1 + N requests per cold build** on the Data API: 600 items would exceed a 150/min budget and stall on `Retry-After`. Prefer `source: "cdn"` for builds, or render from the list (no per-page lookups); a future "build prefetch" could serve slug lookups from the cached list.

**Build-time environment on Webflow Cloud (new):**

- The CLI builds locally **without the app's Cloud env vars**: `generateStaticParams` failed with "Missing Webflow API token".
- **The Webflow CLI reads `WEBFLOW_API_TOKEN` itself** (from `.env` and the environment; it expects a *workspace* token). Exporting our site token under that name made `webflow apps deploy` fail with "Your access token is missing required permissions". Same variable name as next-webflow's.
- Interim workaround: export the token as `WEBFLOW_BUILD_TOKEN` and pass it as `token`. **Resolved (2026-10-21) by renaming next-webflow's variable to `WEBFLOW_CMS_TOKEN`**: the deploy shell now exports `local.env` as is (`set -a; . ./local.env; set +a`), the CLI keeps using its own login, the build reads the token, and no exported value (token, webhook secret, spike secret) appears in any file under `.open-next/` or `.next/` (unlike `.env*` values, see "Deploying the spike"). Cloud's old `WEBFLOW_API_TOKEN` secret was deleted.
- `/items/live` of a collection that was **never published** answers **404**, not an empty list, so `getItems` throws `WebflowNotFoundError`.

**Never-published collection on a prerendered page (2026-10-21).** Library change: a 404 on a live list of a collection that exists → `getItems` returns `[]`, `getItemBySlug` `null`, one debug log. Not cacheable (Next.js only caches 200 responses, `patch-fetch.js:707`) and, after this experiment, not memoized either: a per-instance memo could outlive the publish webhook and regenerate the page empty. Experiment: `npm run never-published` created `never-published` (`6ad905e9012451f40a7889ce`) with one queued item; `/never` is a static page listing it.

| Step | Local (`next build` + `next start`) | Cloud (deploy `never` build) |
| --- | --- | --- |
| Build | `○ /never` prerendered, 0 items; `.next/server/app/never.meta` → `x-next-cache-tags: …,webflow,webflow:collection:6ad905e9…` | prerendered, 0 items |
| Site publish (API, 18:37:17) | live list 200 at 18:37:22; `revalidateTag("webflow")` by hand (no webhook locally) | `site_publish` webhook at 18:37:20 |
| Next request | **1 item** | **1 item** at 18:37:29 |

Next.js collects a fetch's tags onto the prerender **before** the request and regardless of its status (`patch-fetch.js:340-371`), so the empty page still carries the collection and site tags and the first publish invalidates it. No dynamic opt-in (`connection()`) needed. The collection was deleted afterwards (unit tests cover the case; `npm run never-published` recreates it).

### 7. Stage 2b on Cloud: build-time list lookups and `include` (2026-10-21)

`/load/[slug]` now uses `getItemBySlug("load-test", slug, { include: ["author"] })`.

| | Before (5b, `?slug=` per page) | After (2b) |
| --- | --- | --- |
| `load-test` requests in a cold local build (35 pages) | 36 (1 list + 35 slug lookups) | **1** network request + 35 data-cache hits (0–14 ms) |
| `authors` (include) | – | ~7 network requests (concurrent first renders in 10 workers miss together) + hits; **expected behavior**, not optimized: it's bounded by the number of build workers, not by pages |
| Tags on a prerendered page | `webflow`, collection, slug | `webflow`, `load-test` collection, `authors` collection |

`NEXT_PHASE` is set in Next 16 build workers (the list path was taken). After the deploy: staged edit + `POST /items/publish` of `load-test-item-7` (18:56:38) → `collection_item_published` → the prerendered page showed the new name on the first check, on Cloud and locally (after `revalidateTag` of the collection tag).

Found while deploying (upstream finding 13): **the CLI's build reuses `.next/cache/fetch-cache` from earlier local builds** (`generateStaticParams` took 19 ms: all hits), so prerendered pages can carry data from an old build. `npm run deploy` now deletes `.next/cache/fetch-cache` first; the README tells users to.

Build-time cost of list lookups (each page parses every cached list page), estimated with synthetic 100-item pages built from real `load-test` items (232 KB per page): ~6.5 ms per page lookup at 5,000 items (~33 s CPU, ~3 s over 10 workers), ~26 ms at 20,000 (~52 s over 10 workers). Hence a **warning** at 5,000 (`maxBuildListItems`), not a fallback to per-slug requests.

### 8. Draft mode on Cloud (stage 6, 2026-10-21)

Route `/api/webflow/draft` = `createDraftHandler({ schema, resolvePath })`; `WEBFLOW_PREVIEW_SECRET` uploaded as a Cloud secret. `load-test-item-8` edited in staging only (name "Item 8 DRAFT", slug `load-test-item-8-draft`), link made with `npx next-webflow preview-url` (by item ID):

| Step | Result |
| --- | --- |
| Public page | live name |
| Signed link | 307 → `/spike/load/load-test-item-8-draft`; `__prerender_bypass` cookie set |
| Follow with the cookie | staged name, new slug, author included |
| Same draft slug without the cookie | 404 |
| Tampered link (`collection` changed) | 401 "Invalid preview link signature" |
| `?disable=1&path=/load/load-test-item-8` | 307 → `/spike/load/load-test-item-8`, live name again; draft slug 404 |
| `?disable=1&path=//evil.com` | 307 → `/spike/` |
| Link with `--expires 1`, used 2 s later | 401 "expired" |

**Base path in route handlers:** the first deploy redirected to `/load/…` (no `/spike`). A debug route showed `request.url` = `https://…webflow.io/api/debug-url`, `nextUrl.basePath` = `""`, but `process.env.__NEXT_ROUTER_BASEPATH` = `/spike` (inlined by Next at build). The handler now resolves `basePath` option → `NEXT_PUBLIC_BASE_PATH` (Webflow's documented variable; set to `/spike` in the spike's Cloud env) → the inlined internal (upstream finding 14). The staged edit was reverted afterwards.

**Protected drafts page (README example copied verbatim into `src/proxy.ts` and `src/app/drafts/page.tsx`):** Next 16 `proxy.ts` builds with "Node.js middleware support is experimental in cloudflare" and works: `/spike/drafts` → 401 with `WWW-Authenticate: Basic realm="Drafts"` without or with a wrong password, 200 with `DRAFTS_PASSWORD`; the listed links carry `/spike` (via `next/link`) and redirect to the staged item.

### 9. Components on Cloud (stage 7, 2026-10-21)

`/components` (dynamic, so the parser runs in workerd at request time):

| Check | Result |
| --- | --- |
| Real Rich Text (`posts` body) | rendered inside `.w-richtext` |
| Same-site link / external link | `/spike/load/load-test-item-1` (next/link adds the base path) / plain `https://example.com` |
| `<wf-component name="Callout">` with `webflowComponents` | `<aside data-title="Heads up"><p>Bring your towel.</p></aside>` |
| 13 Rich Text probes with execution vectors, as read back from the API | 0 `<script>`, 0 handlers, 0 `javascript:`, 0 `srcdoc`, 0 `<object>`/`<embed>` |
| Server bundle | no `DOMParser`, no html-dom-parser client build |
| `WebflowImage` 640×360 | `srcSet` lists the **same original URL** for every width: Cloud's loader doesn't optimize Webflow CDN images |
| `DraftModeBanner` | absent without the cookie; with it, "Exit preview" → `/spike/api/webflow/draft?disable=1&path=%2Fcomponents` → 307 back, banner gone |

The builder's `webflow-loader.ts` (CLI template, `images.loader: "custom"`, merged over the app's `images` settings) returns absolute URLs unchanged on purpose (its comment: external images aren't optimized, and resizing Webflow-hosted images would be billed twice); only relative `src` go through `/cdn-cgi/image/`. So `unoptimized` (prop or `images.unoptimized`) is the way to drop the repeated `srcSet`. **Real editor post (`cms-trends-2023-5`, 2026-10-21), Playwright on Cloud at 1280 and 390 px:** both video figures (YouTube 854:480, tweet via Embedly 500:281) measure exactly their `aspect-ratio` (1.779 = 1.779), iframe = figure, `padding-bottom` 0, no gap under the iframe. The first deploy showed Rich Text images overflowing (1920 px, Webflow's `width="auto"`): fixed by fitting figure images (`max-width:100%;height:auto`); after it, nothing in the Rich Text is wider than the viewport. The only page overflow on mobile is the spike's own 640 px `WebflowImage` (plain `next/image` sizing). **Tweets at 16:9 are clipped on mobile** (Embedly's card is taller than its stored 500:281 when narrow); fine on desktop.

Webflow's CDN itself doesn't resize: `?width=`, `?w=`, `?q=`, `?format=webp` return the same 176,995-byte JPEG; `-p-500` variants 403; `/cdn-cgi/image/…` 404.

### What a paid plan (Premium, 20K items) would let us measure for real

Everything above for 100-item pages and > 50 items is **extrapolated** from `load-test` (35 items, ~2.4 KB each). Plan (decided 2026-10-21): upgrade the test site for one month right before releasing v0.1 and measure the final library once. **Release blockers** (can force code changes): 2, 4, 5. **Documentation numbers**: 1, 3, 6. Measurements that need the upgrade:

1. *(docs)* **Size and latency of a real 100-item page** (`/items/live?limit=100`), Data API and CDN: decides the 2 MB data cache warning and the per-page time used everywhere below.
2. *(release blocker)* **Cold `getItems` over > 6 pages of 100** (≥ 700 items) on Cloud: time against the 20 s limit, requests, and rate limit used with concurrency 4.
3. *(docs)* **`include` at the threshold:** a referenced collection of ~1,000 items (10 pages) fetched whole, cold and warm; and above it (e.g. 1,500), the by-ID path with many references per page.
4. *(release blocker)* **`generateStaticParams` builds with hundreds of pages:** 1 + N vs build-time list lookups (2b), Data API vs CDN, and how the build stalls on `Retry-After` when the budget runs out.
5. *(release blocker)* **A real `collection_item_published` with `items[100]`** (API publish of 100 IDs): handler round trip and whether all ~200 deferred tag writes land in D1.
6. *(docs)* **Rate limit on a paid plan:** whether `X-RateLimit-Limit` matches the plan (120) or the 150 seen on Starter (upstream finding 11).

## Contract test (real API vs fixtures)

`WEBFLOW_CONTRACT=1 pnpm test:contract` from the repo. Output in `packages/next-webflow/test/contract/output/`.

Run on 2026-10-20 against the test site (`next-webflow-d8ce88.webflow.io`): 10/10 passing.

| Question | Answer |
| --- | --- |
| Reference target collection: `validations.collectionId` or `metadata.collectionId`? | `validations.collectionId` (`metadata` absent). |
| Empty optional fields: omitted or `null`? | `null`, on live and staged items. `Switch` sends `false`. |
| `cmsLocaleId` present on items? | Yes. |
| Draft-only item: 404 on live endpoint? | Yes; the staged endpoint returns it. |
| CDN returns the same live items? `cf-cache-status`? | Same items. `MISS` on the first request. |
| Shape differences vs fixtures | `VideoLink` is `{ url, metadata }` (not a string); `lastPublished` is `null` on every live item (set on staged ones); `alt: null` on images/files; extra `createdOn`/`lastUpdated`/`fieldGroups`/`helpText` on collections. Fixtures now come from these responses. |
| Field types | All except `ExtFileRef` (not creatable in the Designer). |

## Conclusion

**The default mode works on Webflow Cloud, but only with app-provided cache config.** Out of the box (builder-generated `open-next.config.ts`) there is no data cache and `revalidateTag` is a no-op. With a KV incremental cache + D1 tag cache, `force-cache` is shared across isolates and `revalidateTag` shows fresh data in ~1 s.

For v0.2 (decided 2026-10-21): document the KV + D1 setup (`open-next.config.ts`, `wrangler.json` bindings, D1 migration) and the builder pitfalls (deletes `open-next.config.ts`, secrets only through `env-vars import --secret`, `npm ci` uses the lockfile). No library changes needed. Fallback if it regresses: `source: "cdn"` as the Cloud default (up to 5 min stale after publish). A library-owned KV cache only if there's demand. Route handlers must not export `runtime = "edge"` (500 on Cloud).

Verified end to end: new Option → schema fallback warning + correct name; cached list → collection-tag revalidation → fresh in ~1 s.

Still to measure: cross-region staleness, a redeploy, and pagination with > 6 pages of 100 (needs > 600 items).
