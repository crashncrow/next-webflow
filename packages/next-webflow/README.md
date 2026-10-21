# next-webflow

Use the Webflow CMS as a headless content source in Next.js (App Router): generated types, caching, on-demand revalidation via webhooks, draft previews, and rendering components.

> **Work in progress.** Not published yet. The full README (setup, API, deployment) comes with v0.1.

## Tokens and scopes

next-webflow reads **`WEBFLOW_CMS_TOKEN`**, a site token (Site settings → Apps & integrations → API access). It never reads `WEBFLOW_API_TOKEN`: that's the Webflow CLI's variable and holds a *workspace* token. If only `WEBFLOW_API_TOKEN` is set, the error message says so.

| Used by | Token | Scopes |
| --- | --- | --- |
| Your app at runtime (`getItems`, …) and builds | `WEBFLOW_CMS_TOKEN` | CMS: Read (read-only) |
| `npx next-webflow typegen` | same token | CMS: Read |
| `npx next-webflow webhooks register / list / unregister` | a separate site token, e.g. `WEBFLOW_ADMIN_TOKEN`, via `--token-env WEBFLOW_ADMIN_TOKEN` (or `--token`) | Sites: Read and write + CMS: Read |
| `webflow apps deploy` (Webflow CLI, Cloud) | `WEBFLOW_API_TOKEN` | workspace token (Webflow's docs) |

Keep the runtime token read-only. `--token <value>` works on every CLI command, but `--token-env` keeps the token out of your shell history.

## Types (`typegen`)

```bash
npx next-webflow typegen          # reads WEBFLOW_CMS_TOKEN + WEBFLOW_SITE_ID (env or .env.local); CMS: Read is enough
npx next-webflow typegen --check  # CI: exit 1 if webflow/schema.ts no longer matches the site
```

It writes two files in `webflow/` (`--out` to change it):

- **`schema.ts`** is regenerated on every run. Don't edit it. It holds the runtime schema (field slugs, Option names, reference targets) and one item type per collection: `posts` → `PostsItem`, `blog-posts` → `BlogPostsItem`, `2024-events` → `Collection2024EventsItem`. Names are never singularized, so they are predictable in any language. If two collections map to the same name (`blog-posts` and `blog_posts`), typegen stops with an error.
- **`index.ts`** is created once and then belongs to you. typegen never overwrites it unless you pass `--force`. Put client options and friendlier type names here:

```ts
// webflow/index.ts
import { createWebflow } from "next-webflow";
import { schema, type PostsItem } from "./schema";

export const { getItems, getItemBySlug, getItem } = createWebflow({ schema, source: "cdn" });
export type * from "./schema";
export type Post = PostsItem; // friendlier alias
```

Then import from your folder: `import { getItems, type Post } from "@/webflow"`. Types follow `schema.ts` as long as `index.ts` imports it; typegen warns if it doesn't. `--check` ignores formatting (Prettier is fine): it compares a hash stored in the file header.

## Field values

Items are normalized: `fieldData` keys are camelCase, empty fields are absent, and Option fields are `{ id, name }`.

### Video links

A `VideoLink` field is an object:

```ts
post.fieldData.video?.url; // "https://vimeo.com/114900089"
post.fieldData.video?.metadata?.thumbnailUrl;
post.fieldData.video?.metadata?.aspectRatio; // width / height, computed by next-webflow
```

`metadata` is oEmbed data that Webflow fetches through Embedly. Every key is optional and varies by provider.

> **Security:** `metadata.html` is third-party iframe HTML from Embedly. next-webflow exposes it as data only and never renders it. If you render it (for example with `dangerouslySetInnerHTML`), you are trusting markup from Embedly and the video provider. Prefer building your own player from `url`.

## References (`include`)

```ts
const posts = await getItems("posts", { include: ["author", "coAuthors"] });
posts[0].fieldData.author;    // AuthorsItem | null
posts[0].fieldData.coAuthors; // AuthorsItem[]
```

- One level deep, on `getItems`, `getItemBySlug` and `getItem`. Fields you don't include keep their IDs.
- A missing or unpublished referenced item is `null` (Reference) or left out of the array (MultiReference). `{ raw: true }` keeps the original IDs and positions (and can't be combined with `include`).
- **How it fetches:** if the referenced collection has at most `maxIncludeItems` items (default 1,000), next-webflow reads the whole collection once, cached under its collection tag. Above that, it reads only the referenced items, by ID, each cached under its item tag. Either way the page keeps the tags it needs, so republishing a referenced item refreshes it.
- Cost (cold cache, **extrapolated** from a 35-item test collection, ~2.4 KB per item; not measured on 100-item pages yet): ≈ 0.3–0.6 s and 1 request per 100 items of the referenced collection, 4 pages in parallel. At the 1,000-item default that's ≤ 10 requests and ~1–2 s, once; afterwards it's a cache hit.

## Builds (`generateStaticParams`)

During `next build`, `getItemBySlug` doesn't send one `?slug=` request per page. Every page reads the collection's cached list (the same pages `getItems` fetches) and finds its slug there, so a build costs about one request per 100 items instead of one per page, and every page still carries the collection tag for webhooks. Measured on 35 pages: 1 API request for the list instead of 36.

- Above `maxBuildListItems` (default 5,000) it warns, because every page reads the whole cached list. Estimated parsing cost: ~7 ms per page at 5,000 items (~3 s across 10 build workers), ~26 ms at 20,000 (~1 min). Lookups keep using the list.
- Alternatives for very large collections: prerender a subset in `generateStaticParams` and let the rest render on demand (`dynamicParams`, the default), or use `source: "cdn"` (no rate limit). `buildSlugLookups: "request"` restores one request per page.
- Next.js doesn't cache responses over 2 MB. next-webflow warns if a list page is that big (items averaging over ~20 KB, e.g. very long rich text).

## Webhooks

`npx next-webflow webhooks register --url https://your-site.com/api/webflow` subscribes to every CMS event and `site_publish`. The handler invalidates:

| Event | Invalidates |
| --- | --- |
| `collection_item_published` / `_unpublished` / `_deleted` | the item and its collection |
| `collection_item_created` / `_changed` | the item and its collection, **except** staged edits (`isDraft: true`). Writes to live items through the API (`/items/live`) fire only these events. |
| `site_publish` | everything |

If a payload has no `isDraft`, the handler invalidates: a wrong guess costs a refetch, never stale content. Set `invalidateOnStagedChanges: true` to invalidate on staged edits too.

### Collections that were never published

Webflow answers 404 on the live items of a collection that exists but was never published. next-webflow treats it as empty: `getItems` returns `[]` and `getItemBySlug` returns `null` (a missing collection still throws). Pages rendered this way keep the collection's cache tags, so the first site publish refreshes them.

### Known Webflow behavior: deleted items linger in live lists

After you delete a published item, Webflow's `/items/live` list (and `?slug=` lookups) keeps returning it until the next site publish, even though the item itself returns 404 (measured on 2026-10-21: still listed after 10 minutes). next-webflow invalidates on the delete webhook, but the refetch gets the same stale list from Webflow. **Workaround:** publish the site after deleting items. The `site_publish` webhook then invalidates everything, and the item disappears. This is Webflow's behavior, not something next-webflow requires.

## Webflow Cloud notes (preview)

Measured on Webflow Cloud on 2026-10-21 (Next.js 16.4, `@opennextjs/cloudflare` 1.20):

- **Don't add `export const runtime = "edge"` to route handlers.** Webflow's docs say API routes need the edge runtime, but in our tests every edge route returned `500 Internal Server Error`, while the same handlers on the default Node.js runtime worked. next-webflow's route handlers (webhook, draft) don't export `runtime`.
- **Keep secrets out of `.env*` files when deploying.** `webflow apps deploy` builds on your machine, and the build bakes every `.env*` file into the worker bundle in plain text. Upload variables with `webflow apps env-vars import <file> --secret` instead.
- **Clear the build's data cache before deploying.** The CLI builds in your working copy and reuses `.next/cache/fetch-cache` from earlier local builds, so prerendered pages can contain data from an old build. Delete `.next/cache/fetch-cache` before `webflow apps deploy` (deploying from CI with a fresh checkout avoids it).
- **Builds don't see Cloud's variables.** The CLI builds locally, so `generateStaticParams` and other build-time reads need `WEBFLOW_CMS_TOKEN` in the deploy shell's environment (e.g. `set -a; . ./local.env; set +a` before `webflow apps deploy`). Values from the process environment are not written into the bundle (checked on 2026-10-21); `.env*` files are.
