# Deploying to Webflow Cloud (preview)

next-webflow works on [Webflow Cloud](https://developers.webflow.com/webflow-cloud), Webflow's hosting for Next.js apps, with the setup below. Support is a **preview**: it was measured on 2026-10-21 (Next.js 16.4, `@opennextjs/cloudflare` 1.20) and becomes official in a later version. Full measurements: [Webflow Cloud spike](webflow-cloud-spike.md).

## 1. Add a cache configuration

**Caching doesn't work by default.** Without your own `open-next.config.ts`, Webflow's builder generates one with dummy caches: there's no data cache (every request hits Webflow's API) and `revalidateTag` does nothing, so webhooks can't refresh pages.

Commit these three files and Cloud provisions a KV namespace and a D1 database:

```ts
// open-next.config.ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

export default defineCloudflareConfig({ incrementalCache: kvIncrementalCache, tagCache: d1NextTagCache });
```

```jsonc
// wrangler.json
{
  "kv_namespaces": [{ "binding": "NEXT_INC_CACHE_KV", "id": "local" }],
  "d1_databases": [
    {
      "binding": "NEXT_TAG_CACHE_D1",
      "database_name": "next-tag-cache",
      "database_id": "0",
      "migrations_dir": "migrations",
    },
  ],
}
```

```sql
-- migrations/0001_revalidations.sql (the table OpenNext's D1 tag cache uses)
CREATE TABLE IF NOT EXISTS revalidations (tag TEXT NOT NULL, revalidatedAt INTEGER NOT NULL, stale INTEGER, expire INTEGER default NULL, UNIQUE(tag) ON CONFLICT REPLACE);
```

With it, cached reads hit across isolates and a webhook's invalidation is visible about 1 s later.

**`webflow apps deploy` deletes `open-next.config.ts` from your working copy after deploying** (the deploy itself used it). Restore it with `git checkout -- open-next.config.ts` before the next local deploy. Deploys from a fresh CI checkout are unaffected.

## 2. Set the base path

Set **`NEXT_PUBLIC_BASE_PATH`** to the app's mount path (e.g. `/app`), as Webflow's docs recommend. Route handlers on Cloud don't see the mount path in the request URL, so the draft route uses this variable for its redirects (`basePath` in `createDraftHandler` overrides it).

`next/link` adds the base path by itself; plain `<a>`, `<img>` and `fetch` URLs to your own app need it. In server code, `nextBasePath()` from `next-webflow/draft` returns it with the same fallbacks the draft route uses (`NEXT_PUBLIC_BASE_PATH`, then the base path Next.js inlines), or `undefined` when there's none:

```tsx
import { nextBasePath } from "next-webflow/draft";

const base = nextBasePath() ?? "";
// <img src={`${base}/logo.svg`} alt="" />, fetch(`${origin}${base}/api/…`)
```

## 3. Keep the default runtime

**Don't add `export const runtime = "edge"` to route handlers.** Webflow's docs say API routes need the edge runtime, but in our tests every edge route returned `500 Internal Server Error`, while the same handlers on the default Node.js runtime worked. next-webflow's route handlers (webhook, draft) don't export `runtime`.

## 4. Keep secrets out of `.env*` files

Upload secrets with `webflow apps env-vars import <file> --secret`, and keep them out of every `.env*` file before deploying.

`webflow apps deploy` builds on your machine with OpenNext, which reads your `.env*` files and writes their values in plain text into the deployed worker (`.open-next/cloudflare/next-env.mjs`), so that `process.env` behaves as with `next start`. See [`compile-env-files.ts`](https://github.com/opennextjs/opennextjs-cloudflare/blob/%40opennextjs/cloudflare%401.20.12/packages/cloudflare/src/cli/build/open-next/compile-env-files.ts) and [`extract-project-env-vars.ts`](https://github.com/opennextjs/opennextjs-cloudflare/blob/%40opennextjs/cloudflare%401.20.12/packages/cloudflare/src/cli/utils/extract-project-env-vars.ts) in `@opennextjs/cloudflare` 1.20.12.

- That covers files of every mode (`.env`, `.env.local`, `.env.production`, `.env.development.local`, `.env.test`…), in the app directory and, if the app is part of a monorepo, at its root (the nearest parent folder with a lockfile).
- The values stay server-side (they don't reach client assets), and variables set in Cloud take precedence at runtime. But a secret in any of those files ships inside your worker code instead of Cloud's encrypted variables.
- Keep local values in a file not named `.env*` (e.g. `local.env`).

## 5. Give builds the token

The CLI builds locally, without Cloud's variables, so `generateStaticParams` and other build-time reads need `WEBFLOW_CMS_TOKEN` in the deploy shell's environment:

```bash
set -a; . ./local.env; set +a   # values in a file not named .env*
webflow apps deploy
```

Variables exported in the shell are read by the build but not written into the worker. `webflow apps deploy` itself uses `WEBFLOW_API_TOKEN`, a **workspace** token (Webflow's docs); next-webflow never reads that variable.

## 6. Clear the build's data cache before deploying

The CLI builds in your working copy and reuses `.next/cache/fetch-cache` from earlier local builds, so prerendered pages can contain data from an old build. Delete `.next/cache/fetch-cache` before `webflow apps deploy`. Deploying from CI with a fresh checkout avoids it.

## Images

On Webflow Cloud, CMS images are always served at their original size. Neither Webflow's CDN nor `next/image` resizes them: the Cloud builder installs its own image loader, which returns absolute URLs unchanged, so every `srcSet` entry is the original file. This is by design: Webflow's loader skips absolute URLs on purpose, so that resizing images already hosted on Webflow's CDN isn't billed as bandwidth twice.

- **Upload pre-optimized images:** resized to the largest size you display (e.g. 2× the layout width) and compressed (WebP or AVIF, or a well-compressed JPEG).
- Pass `unoptimized` to `WebflowImage` to skip the `srcSet` that repeats the same file (the browser downloads it once either way, so this only trims HTML).
- For every image at once, set `images: { unoptimized: true }` in `next.config.ts`. The Cloud builder keeps your `images` settings, but this also turns off resizing for local images in `public/`, which Cloud's loader sends through its image resizer.

## Drafts page

Next 16's `proxy.ts` works on Webflow Cloud, but OpenNext marks Node.js middleware as experimental (a warning at build time; verified working on 2026-10-21). The drafts page's own password check still protects it if the proxy ever stops running.
