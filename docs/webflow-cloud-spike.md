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

`webflow apps deploy` builds locally and OpenNext bakes every `.env*` file into the worker bundle in plain text (`.open-next/cloudflare/next-env.mjs`). So the spike keeps its values in **`local.env`** (deploy vars) and **`seed.env`** (write token, local only), both git-ignored and never named `.env*`.

```bash
cp local.env.example local.env          # fill in: read-only token, site ID, SPIKE_SECRET
npm run deploy                          # refuses if any .env* file exists, then `webflow apps deploy`
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

Caveats: one run, from one client location (Worker placement `local-IAD`); KV is eventually consistent across locations, which this can't show, but invalidation is decided by the D1 tag table, so a stale KV entry is treated as a miss. Cache entries are keyed by build ID, so a redeploy starts cold. The builder **deletes `open-next.config.ts` after each deploy** ("cleaning up additional config file"); `npm run deploy` refuses to run without it.

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

Conclusions:
- Flags are `isArchived`/`isDraft`; `collection_item_published` uses `items[]`, every other item event a flat item (upstream finding 5).
- `isDraft` is `true` only while an item has staged changes. Mapping changed (2026-10-21): `created`/`changed` invalidate unless `isDraft === true` (fail-safe; timestamps are logged, never used), and `webhooks register` subscribes to every CMS event by default. Fixes case 7.
- Case 4 is a Webflow API inconsistency (upstream finding 8). README documents publishing the site after deletes.
- The Cloud app kept serving after site publishes. Raw payloads → `test/fixtures/api/webhooks/` (`publishedBy` anonymized).

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

For v0.2 (decided 2026-10-21): document the KV + D1 setup (`open-next.config.ts`, `wrangler.json` bindings, D1 migration) and the builder pitfalls (deletes `open-next.config.ts`, bakes `.env*` into the bundle, `npm ci` uses the lockfile). No library changes needed. Fallback if it regresses: `source: "cdn"` as the Cloud default (up to 5 min stale after publish). A library-owned KV cache only if there's demand. Route handlers must not export `runtime = "edge"` (500 on Cloud).

Verified end to end: new Option → schema fallback warning + correct name; cached list → collection-tag revalidation → fresh in ~1 s.

Still to measure: cross-region staleness, a redeploy, and pagination with > 6 pages of 100 (needs > 600 items).
