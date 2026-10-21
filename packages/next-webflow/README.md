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

## Draft mode (previews)

Previews use **signed links that expire**: the secret never appears in a URL. A link names a collection and an **item ID** (it survives slug changes while editors work); the route reads the staged item, enables Next.js draft mode and redirects to the item's current path. While draft mode is on, every read returns staged content from the Data API, uncached.

```ts
// app/api/webflow/draft/route.ts (don't export `runtime`)
import { createDraftHandler } from "next-webflow/draft";
import { schema } from "@/webflow/schema";

export const { GET, DELETE } = createDraftHandler({
  schema,
  resolvePath: (collection, item) => `/blog/${item.fieldData.slug}`, // required
});
```

- Set `WEBFLOW_PREVIEW_SECRET` (a long random string; comma-separated values all verify, the first signs, for rotation).
- Links last 1 hour by default (`expiresIn`); the route rejects links that claim to live longer than 30 days (`maxLinkLifetimeSeconds`).
- Leave preview with `GET /api/webflow/draft?disable=1&path=/blog/x` (redirects; `path` must be a same-site path, anything else goes to `/`) or `DELETE` (no redirect). Export `DELETE` from the route if you use it.
- Redirects include the app's base path. On Webflow Cloud set `NEXT_PUBLIC_BASE_PATH` to the mount path (as Webflow's docs recommend); otherwise next-webflow falls back to the base path Next.js inlines at build time (an internal that could change). The `basePath` option overrides both.
- Responses: expired or tampered link → 401, malformed → 400, unknown item or collection → 404, missing `resolvePath` or secret → 500 with the fix.

**Making links.** `createPreviewUrl()` runs on the server (it needs the secret). Developers can also run `npx next-webflow preview-url --url https://example.com/api/webflow/draft --collection posts --item <id>`. Editors won't use a CLI, so give them an internal page that lists drafts with their links.

> **Warning: `unsafeStagedCache` publishes your drafts on any page that uses it.** It reads staged (unpublished) content without draft mode, so whoever can load the page sees every draft. Use it only on a page that is authenticated, like the one below. Never on a public page, and never with `generateStaticParams` or static rendering.

On Webflow Cloud, Next 16's `proxy.ts` works but OpenNext marks Node.js middleware as experimental (warning at build time; verified working on 2026-10-21). The page's own check still protects it if the proxy ever stops running.

The example protects the page twice with HTTP Basic auth (`DRAFTS_PASSWORD`, a long random string; without it, the page answers 503 to everyone): a proxy that asks for the password, and the page itself, which renders nothing without valid credentials, so a wrong `matcher` doesn't expose it. Copy both files.

```ts
// proxy.ts (Next 16; on Next 15 name it middleware.ts and the function `middleware`)
import { NextResponse, type NextRequest } from "next/server";
import { requireBasicAuth } from "next-webflow/draft";

export const config = { matcher: ["/drafts", "/drafts/:path*"] };

export async function proxy(request: NextRequest) {
  const denied = await requireBasicAuth(request, { password: process.env.DRAFTS_PASSWORD, realm: "Drafts" });
  return denied ?? NextResponse.next();
}
```

```tsx
// app/drafts/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createWebflowCms, unsafeStagedCache } from "next-webflow";
import { createPreviewUrl, requireBasicAuth } from "next-webflow/draft";
import { schema } from "@/webflow/schema";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

// Staged content, never cached. Only on this authenticated page.
const staged = createWebflowCms({ schema, cache: unsafeStagedCache });

export default async function Drafts() {
  // Second check: if the proxy's matcher ever misses this page, it still shows nothing.
  if (await requireBasicAuth(await headers(), { password: process.env.DRAFTS_PASSWORD })) notFound();

  const posts = (await staged.getItems("posts")).filter((post) => post.isDraft);
  const links = await Promise.all(
    posts.map((post) => createPreviewUrl({ url: "/api/webflow/draft", collection: "posts", itemId: post.id })),
  );
  return (
    <ul>
      {posts.map((post, index) => (
        <li key={post.id}>
          <Link href={links[index] ?? "#"} prefetch={false}>
            {post.fieldData.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

`next/link` adds the base path on Webflow Cloud; with a plain `<a>`, add it yourself.

## Components (`next-webflow/components`)

Server Components (no `"use client"`, no parser in the browser bundle). The only subpath with runtime dependencies (`html-react-parser`, MIT).

### `WebflowRichText`

```tsx
import { WebflowRichText } from "next-webflow/components";

<WebflowRichText
  html={post.fieldData.body}
  components={{ blockquote: MyQuote }}             // replace elements by tag
  webflowComponents={{ Callout: MyCallout }}       // <wf-component name="Callout"> → your component
/>
```

- Same-site links (`/…`) render with `next/link` (base path included); others stay `<a>`.
- Webflow component instances in Rich Text (`<wf-component>`) render through `webflowComponents` by name: you get scalar props (`props`, by property ID), rendered rich text props (`slots`, by ID; `slotIds` maps labels to IDs) and the parsed node. Without a mapping, their text renders and you get a development warning.
- Images inside Rich Text stay `<img>` (Webflow doesn't give their dimensions); override `img` to change that.
- **Alt text inherited from the asset isn't resolved yet.** When an editor doesn't set alt text on a Rich Text image, Webflow stores a placeholder meaning "use the asset's alt text". next-webflow never renders that placeholder: the image renders as decorative (`alt=""`), and in development a warning names it. The asset may have real alt text that Webflow's own site would show, so ask editors to set alt text on the image itself in the Rich Text field. (Image fields get the same treatment: the placeholder becomes `alt: null`.)
- **Videos and embedded posts** (YouTube, Vimeo, tweets: Webflow stores them all as video figures) render at their aspect ratio without Webflow's CSS: next-webflow replaces Webflow's inline `padding-bottom` with `aspect-ratio` from the figure's dimensions and sizes the iframe to fill it. Webflow's classes (`w-richtext-figure-type-video`, `w-richtext-align-center`…) stay on the elements, so webflow.css or your own styles can still target them, and a `figure` override in `components` receives them (`className`, adjusted `style`).
- **Code blocks come back empty.** Webflow's API returns a Rich Text code block as an empty `<pre></pre>`, even one created in the editor (Webflow's docs say the API doesn't support code blocks). For code samples, use an HTML embed with `<pre><code>` (paid Webflow plans) or a separate field.
- **Image alignment still needs CSS.** Centered, floated and full-width images are `<figure class="w-richtext-figure-type-image w-richtext-align-center|floatleft|floatright|fullwidth">`; Webflow's CSS lays them out. Style those classes yourself or load your site's webflow.css.
- **Sanitized by default.** Rich Text is HTML from your CMS: treat it as untrusted input, since anyone who can edit the CMS (or holds a token with CMS write access) can put scripts in it. next-webflow removes `<script>`, `<object>`, `<embed>`, `<base>`, `<meta>`, every `on*` attribute, `srcdoc`, `javascript:` / `vbscript:` / `data:` URLs (in `href`, `src`, `action`, `formaction`, `xlink:href`, `srcset`, SVG animation values…) and styles with `javascript:` / `expression()`. Iframes with normal URLs (YouTube, Vimeo) and code embeds without scripts still render.
- `allowScripts` turns sanitizing off for that render. **Don't enable it for all content** to make a tweet or an Instagram post work: replace those embeds with a React component through `components` (e.g. detect `blockquote.twitter-tweet` and render your `<Tweet id>`). React 19 blocks `javascript:` links even then.

### `WebflowImage`

```tsx
import { WebflowImage } from "next-webflow/components";

<WebflowImage image={post.fieldData.mainImage} width={1200} height={630} sizes="100vw" />
<WebflowImage image={post.fieldData.mainImage} fill sizes="50vw" /> {/* parent: position relative + size */}
```

- Webflow doesn't report image dimensions, so the types require `width` + `height`, or `fill`.
- Webflow's "inherit the asset's alt text" placeholder is never rendered (see Rich Text above): such images render with `alt=""` and a development warning.
- `alt` comes from the field. Webflow returns `alt: null` when it's empty (every image on our test site): the image renders as decorative (`alt=""`) and, in development, a warning names it once. Pass `alt` to override.
- Allow Webflow's asset CDN in `next.config.ts` (the only asset host in real CMS data; add `i.vimeocdn.com` / `i.ytimg.com` only if you render video thumbnails from `VideoLink` metadata):

  ```ts
  images: { remotePatterns: [{ protocol: "https", hostname: "cdn.prod.website-files.com" }] },
  ```
- **Webflow's CDN doesn't resize images** (verified: `width`, `w`, `q`, `format` parameters are ignored, no `-p-500` variants for CMS images, no `/cdn-cgi/image/`), so next-webflow has no custom loader. On Vercel or `next start`, Next.js' optimizer resizes and re-encodes them.
- **On Webflow Cloud, CMS images are always served at their original size.** Neither Webflow's CDN nor `next/image` resizes them: the Cloud builder installs its own image loader, which returns absolute URLs unchanged, so every `srcSet` entry is the original file. This is by design, not a bug: Webflow's loader skips absolute URLs on purpose, so that resizing images already hosted on Webflow's CDN isn't billed as bandwidth twice (once for the original, once for the resized copy). **Upload pre-optimized images**: resized to the largest size you display (e.g. 2× the layout width) and compressed (WebP or AVIF, or a well-compressed JPEG).
- On Webflow Cloud, pass `unoptimized` to skip the `srcSet` that repeats the same file (the browser downloads it once either way, so this only trims HTML). For every image at once, set `images: { unoptimized: true }` in `next.config.ts`; the Cloud builder keeps your `images` settings, but this also turns off resizing for local images in `public/`, which Cloud's loader sends through its image resizer.

  ```tsx
  <WebflowImage image={post.fieldData.mainImage} width={1200} height={630} unoptimized />
  ```

### `DraftModeBanner`

```tsx
// app/layout.tsx
import { DraftModeBanner } from "next-webflow/components";
// …inside <body>:
<DraftModeBanner />  {/* route="/api/webflow/draft" by default */}
```

Renders only in draft mode: a fixed bar with "Exit preview", linking to the draft route's `?disable=1&path=<current page>` (base path included). The link is a plain `<a>`, not `next/link`, because prefetching it would leave preview by itself. `className` replaces the default inline styles.

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
- **CMS images are served at their original size** (see [`WebflowImage`](#webflowimage)): upload pre-optimized images.
- **Builds don't see Cloud's variables.** The CLI builds locally, so `generateStaticParams` and other build-time reads need `WEBFLOW_CMS_TOKEN` in the deploy shell's environment (e.g. `set -a; . ./local.env; set +a` before `webflow apps deploy`). Values from the process environment are not written into the bundle (checked on 2026-10-21); `.env*` files are.
