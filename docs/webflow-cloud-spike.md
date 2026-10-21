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

## Questions and how they're measured

### 1. Does the Next data cache persist across requests?

Page `/probe` and routes `api/probe` (edge) / `api/probe-node` (node) do a `fetch(..., { cache: "force-cache", next: { tags: ["spike-probe"] } })` to `GET /v2/sites/{id}`. On a HIT the stored response comes back: its `date` and `x-ratelimit-remaining` headers stay frozen and `durationMs` is small. `isolate` identifies the Worker isolate: a HIT across different isolates means a shared cache; only within one isolate means in-memory only.

| Runtime | HIT within an isolate? | HIT across isolates? | Survives a redeploy? | Notes |
| --- | --- | --- | --- | --- |
| page (node) | | | | |
| route (edge) | | | | |
| route (node) | | | | |

### 2. Does `revalidateTag` invalidate, and how fast?

On `/probe`: start polling, then click "revalidateTag (edge route)" / "(node route)". The `since revalidate` column shows when `fetchedAt` changes.

| Revalidated from | Works? | Time until fresh (edge route) | Time until fresh (node route/page) | Errors |
| --- | --- | --- | --- | --- |
| edge route | | | | |
| node route | | | | |

### 3. Pagination vs the 6 concurrent requests limit

`/pagination?c=N` reads the collection with no cache. `?pageSize=1` uses small pages so a few items already give > 6 parallel pages (any site plan); `pageSize=100` is the real `getItems` (needs > 600 items, see `npm run seed`).

| Concurrency | Result | Duration | Notes |
| --- | --- | --- | --- |
| 2 | | | |
| 4 (default) | | | |
| 6 | | | |
| 8 | | | |
| 12 | | | |

### 4. Library on real data (`/library`)

| Check | Result |
| --- | --- |
| `getItems("posts")` without generated schema (API fallback + warning) | |
| With `src/webflow-schema.ts` snapshot: no warnings | |
| After adding a new Option + item using it: warning, correct name via fallback | |
| `getItemBySlug` | |
| Base path: links and client fetches work under the mount path | |

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

_Pending._ If the data cache doesn't persist or `revalidateTag` isn't reliable, propose an alternative Cloud mode (e.g. own KV cache invalidated by the webhook, or `source: "cdn"` by default on Cloud) **before** implementing it.
