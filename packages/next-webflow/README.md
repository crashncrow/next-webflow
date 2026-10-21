# next-webflow

Use the Webflow CMS as a headless content source in Next.js (App Router): generated types, caching, on-demand revalidation via webhooks, draft previews, and rendering components.

> **Work in progress.** Not published yet. The full README (setup, API, deployment) comes with v0.1.

## Types (`typegen`)

```bash
npx next-webflow typegen          # reads WEBFLOW_API_TOKEN + WEBFLOW_SITE_ID (env or .env.local); CMS: Read is enough
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

## Webhooks

`npx next-webflow webhooks register --url https://your-site.com/api/webflow` subscribes to every CMS event and `site_publish`. The handler invalidates:

| Event | Invalidates |
| --- | --- |
| `collection_item_published` / `_unpublished` / `_deleted` | the item and its collection |
| `collection_item_created` / `_changed` | the item and its collection, **except** staged edits (`isDraft: true`). Writes to live items through the API (`/items/live`) fire only these events. |
| `site_publish` | everything |

If a payload has no `isDraft`, the handler invalidates: a wrong guess costs a refetch, never stale content. Set `invalidateOnStagedChanges: true` to invalidate on staged edits too.

### Known Webflow behavior: deleted items linger in live lists

After you delete a published item, Webflow's `/items/live` list (and `?slug=` lookups) keeps returning it until the next site publish, even though the item itself returns 404 (measured on 2026-10-21: still listed after 10 minutes). next-webflow invalidates on the delete webhook, but the refetch gets the same stale list from Webflow. **Workaround:** publish the site after deleting items. The `site_publish` webhook then invalidates everything, and the item disappears. This is Webflow's behavior, not something next-webflow requires.

## Webflow Cloud notes (preview)

Measured on Webflow Cloud on 2026-10-21 (Next.js 16.4, `@opennextjs/cloudflare` 1.20):

- **Don't add `export const runtime = "edge"` to route handlers.** Webflow's docs say API routes need the edge runtime, but in our tests every edge route returned `500 Internal Server Error`, while the same handlers on the default Node.js runtime worked. next-webflow's route handlers (webhook, draft) don't export `runtime`.
- **Keep secrets out of `.env*` files when deploying.** `webflow apps deploy` builds on your machine, and the build bakes every `.env*` file into the worker bundle in plain text. Upload variables with `webflow apps env-vars import <file> --secret` instead.
