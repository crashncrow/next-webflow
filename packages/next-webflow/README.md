# next-webflow

Use the **Webflow CMS as a headless content source in Next.js** (App Router, Next 15 and 16): generated types, caching with on-demand revalidation through webhooks, draft previews, and components to render Rich Text and images.

> Your agents publish with the Webflow MCP; next-webflow makes your Next.js site show it instantly.

- **Types from your site.** `npx next-webflow typegen` writes a typed client: `getItems("posts")` knows every field, rejects collection slugs that don't exist, and turns Option IDs into `{ id, name }`.
- **Fresh content, cached reads.** Reads go through the Next.js data cache with tags per site, collection and item. A signed webhook invalidates exactly what changed, so published content appears on the next request.
- **Draft previews** with signed, expiring links. The secret never appears in a URL.
- **Rendering.** `WebflowRichText` (sanitized, `next/link` for internal links, element overrides), `WebflowImage` (`next/image`), and `DraftModeBanner`.
- **Built for limits.** Transparent pagination, `Retry-After` handling, at most 4 concurrent requests, and builds that read one list per collection instead of one request per page.
- **Edge-compatible runtime** (`fetch` and `crypto.subtle` only). No dependency on `webflow-api`.

> **Status:** v0.1, not published to npm yet. Webflow Cloud works (see [notes](#webflow-cloud-notes-preview)) and becomes formally supported in v0.2.

**Contents:** [Quick start](#quick-start) · [Reading content](#reading-content) · [Field values](#field-values) · [References](#references-include) · [Caching and revalidation](#caching-and-revalidation) · [Webhooks](#webhooks) · [Builds](#builds-generatestaticparams) · [Draft mode](#draft-mode-previews) · [Components](#components-next-webflowcomponents) · [Tokens and scopes](#tokens-and-scopes) · [Types](#types-typegen) · [Known limitations](#known-limitations) · [Webflow Cloud](#webflow-cloud-notes-preview) · [Example app](#example-app)

## Quick start

Requirements: Next.js 15 or 16 with the App Router, React 19, Node.js 22.12 or later (CI runs the tests on 22.12 and on the latest LTS; Node 20 reached end-of-life in April 2026).

**1. Install**

```bash
npm install next-webflow
```

**2. Add your site's credentials** to `.env.local`: a site token with **CMS: Read** (Site settings → Apps & integrations → API access) and the site ID (Site settings → General).

```bash
WEBFLOW_CMS_TOKEN=…
WEBFLOW_SITE_ID=…
```

**3. Generate the typed client**

```bash
npx next-webflow typegen   # writes webflow/schema.ts and webflow/index.ts (--out src/webflow with a src/ directory)
```

**4. Read content** in a Server Component. The `@/` alias comes with `create-next-app`; otherwise add `"paths": { "@/*": ["./*"] }` to `tsconfig.json` (`["./src/*"]` with a `src/` directory) or import with a relative path.

```tsx
// app/page.tsx
import Link from "next/link";
import { getItems } from "@/webflow";

export default async function Home() {
  const posts = await getItems("posts");
  return (
    <ul>
      {posts.map((post) => (
        <li key={post.id}>
          <Link href={`/posts/${post.fieldData.slug}`}>{post.fieldData.name}</Link>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// app/posts/[slug]/page.tsx
import { notFound } from "next/navigation";
import { WebflowRichText } from "next-webflow/components";
import { getItemBySlug, getItems } from "@/webflow";

export async function generateStaticParams() {
  return (await getItems("posts")).map((post) => ({ slug: post.fieldData.slug }));
}

export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const post = await getItemBySlug("posts", (await params).slug);
  if (!post) notFound();
  return (
    <article>
      <h1>{post.fieldData.name}</h1>
      <WebflowRichText html={post.fieldData.body} />
    </article>
  );
}
```

**5. Refresh pages when you publish.** Add the webhook route, deploy, then register the webhooks once:

```ts
// app/api/webflow/route.ts (don't export `runtime`)
export { POST } from "next-webflow/webhook";
```

```bash
npx next-webflow webhooks register --url https://your-site.com/api/webflow --token-env WEBFLOW_ADMIN_TOKEN
```

The command creates signed webhooks for every CMS event and site publishes, and writes their secrets to `WEBFLOW_WEBHOOK_SECRET` in `.env.local` (add that variable to your host too: Webflow shows each secret only once). It needs a separate token with more scopes; see [Tokens and scopes](#tokens-and-scopes).

**6. Optional:** [draft previews](#draft-mode-previews), [components](#components-next-webflowcomponents). [`examples/blog`](https://github.com/crashncrow/next-webflow/tree/main/examples/blog) puts all of it together.

## Reading content

```ts
import { getItems, getItemBySlug, getItem } from "@/webflow";

const posts = await getItems("posts", {
  filter: { featured: { eq: true } },
  sortBy: "lastPublished", // createdOn | lastPublished | lastUpdated | name | slug (Webflow only sorts by these)
  sortOrder: "desc",
  limit: 10, // default: every item; pages of 100 are fetched for you
});
const post = await getItemBySlug("posts", "hello-world"); // or null
const byId = await getItem("posts", itemId); // by item ID (e.g. from a webhook or a reference), or null
```

| Option | Applies to | |
| --- | --- | --- |
| `filter` | `getItems` | Keyed by field (camelCase or API slug). Operators: `eq ne gt gte lt lte in nin contains ncontains exists`. Webflow filters on its side. |
| `sortBy`, `sortOrder` | `getItems` | Only Webflow's sortable properties (above), not custom fields: sort those yourself. |
| `limit`, `offset` | `getItems` | Without `limit`, every item (parallel pages of 100). |
| `include` | all | Replace Reference fields with the referenced items. See [References](#references-include). |
| `cmsLocaleId` | all | Read a secondary locale (default: the primary one). |
| `raw: true` | all | The API's item untouched: slug keys, Option IDs, `null` for empty fields. |
| `signal` | all | An `AbortSignal`. |

Published content comes from Webflow's Data API (`/items/live`) by default; in [draft mode](#draft-mode-previews) the same calls return staged content. Other options of `createWebflow` (in `webflow/index.ts`): `source: "cdn"` (see [Data API or CDN](#data-api-or-cdn)), `maxIncludeItems`, `maxBuildListItems`, `buildSlugLookups`, `retry` (`maxRetries`, `baseDelayMs`, `maxDelayMs`, `maxRetryAfterMs`), `concurrency` (default 4), `token`, `siteId`, `logger`.

**Errors.** A missing item is `null`, not an error. Everything else throws a subclass of `WebflowError`, exported from `next-webflow`: `WebflowConfigError` (no token, unknown collection), `WebflowUnauthorizedError` / `WebflowForbiddenError` (token or scopes), `WebflowRateLimitError` (after retries, or when `Retry-After` exceeds `maxRetryAfterMs`; has `retryAfterMs`), `WebflowServerError`, `WebflowNetworkError`. 429 responses are retried honoring `Retry-After`; 5xx and network errors are retried for reads.

**Schema changes.** If an item has fields or Option values your generated schema doesn't know (someone edited the collection), next-webflow fetches the current schema, keeps serving the data, and warns once: rerun `npx next-webflow typegen`. Use `typegen --check` in CI.

## Field values

Items are normalized: `fieldData` keys are camelCase (`main-image` → `mainImage`), empty fields are absent (Webflow sends `null`), and optional fields are typed optional.

| Webflow type | Value | TypeScript |
| --- | --- | --- |
| Plain text, Link, Email, Phone, Color | string | `string` |
| Rich text | HTML string, unsanitized (render with [`WebflowRichText`](#webflowrichtext), which sanitizes it) | `string` |
| Number | number | `number` |
| Switch | boolean (`false` is sent, not omitted) | `boolean` |
| Date/Time | ISO 8601 string | `string` |
| Option | `{ id, name }` | `{ id: "…"; name: "News" } \| …` per option, plus `{ id; name: undefined }` for an option the schema doesn't know |
| Image, File | `{ fileId, url, alt }` | `WebflowImage`, `WebflowFile` (`alt` may be `null`) |
| Multi-image | array of images | `WebflowImage[]` |
| Video link | `{ url, metadata? }` | `WebflowVideo` |
| Reference | item ID, or the item with `include` | `string`, or `Item \| null` |
| Multi-reference | item IDs, or the items with `include` | `string[]`, or `Item[]` |
| External file reference | as returned | `unknown` (typegen warns) |

**Options.** Webflow returns the option's ID; next-webflow adds its name from the schema. Compare by `id` (stable) and display `name` (editors can rename options). `name` is a union of the names in your schema, or `undefined` for an option added after the last typegen that the API schema doesn't resolve either.

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

## Caching and revalidation

Every read is a `fetch` with `cache: "force-cache"` and cache tags, so pages are static until a tag is invalidated:

| Tag | On | Invalidated by |
| --- | --- | --- |
| `webflow` | every read | `site_publish` |
| `webflow:collection:<collectionId>` | lists, slug lookups, `include` of a whole collection | any CMS event in that collection |
| `webflow:item:<itemId>` | `getItem`, `include` by ID | CMS events for that item |

- Invalidation uses `revalidateTag(tag, { expire: 0 })`: the next request fetches fresh content (people who publish expect to see it). Pass `profile: "max"` (or another profile) to `createWebhookHandler` to serve stale content while revalidating instead.
- Slug lookups carry the collection tag, so renaming a slug refreshes the old URL too (it then returns `null` → `notFound()`). The trade-off: any change in a collection refreshes all its cached slug lookups, lazily, on their next visit.
- next-webflow doesn't use `"use cache"` (unsupported on Webflow Cloud). Draft mode bypasses the cache.
- Reads in route handlers, server actions or dynamic pages are cached the same way.

### Data API or CDN

| | `source: "data"` (default) | `source: "cdn"` |
| --- | --- | --- |
| Reads from | Data API, `/items/live` | Content Delivery API (`api-cdn.webflow.com`) |
| Freshness after publishing | Immediate, with webhooks | Up to 5 minutes (2 on Enterprise): Webflow doesn't purge the CDN on publish |
| Rate limit | Every cache miss counts (60–120 requests/minute by plan) | CDN cache hits don't count |
| Use it when | You registered webhooks (recommended) | No webhooks, very large builds, or rate limits are tight and a few minutes of delay is fine |

With `cdn` and webhooks together, a webhook can refetch before the CDN has the new content and cache the old version again; prefer `data` with webhooks. Schemas, draft mode and staged reads always use the Data API.

## Webhooks

`npx next-webflow webhooks register --url https://your-site.com/api/webflow` subscribes to every CMS event and `site_publish`. The handler invalidates:

| Event | Invalidates |
| --- | --- |
| `collection_item_published` / `_unpublished` / `_deleted` | the item and its collection |
| `collection_item_created` / `_changed` | the item and its collection, **except** staged edits (`isDraft: true`). Writes to live items through the API (`/items/live`) fire only these events. |
| `site_publish` | everything |

If a payload has no `isDraft`, the handler invalidates: a wrong guess costs a refetch, never stale content.

- Webhooks are **verified** (HMAC-SHA256 of the raw body, timestamps older than 5 minutes rejected). Unsigned requests get 401 with an explanation: webhooks created in Webflow's dashboard aren't signed, so register them with the command. `WEBFLOW_WEBHOOK_SECRET` holds one secret per webhook, comma-separated.
- `npx next-webflow webhooks list` shows them; `webhooks unregister --url …` removes them.
- For more control, `createWebhookHandler(options)`: `secret`, `profile`, `invalidateOnStagedChanges` (also invalidate on staged edits), `extraTags(event)`, `tags(event, defaults)` (replace the mapping), `onEvent(event, tags)` (logging, notifications; throwing returns 500 so Webflow retries), `logger`, `toleranceMs`. `allowUnsigned` exists but is insecure.

```ts
// app/api/webflow/route.ts
import { createWebhookHandler } from "next-webflow/webhook";

export const POST = createWebhookHandler({ onEvent: (event, tags) => console.log(event.triggerType, tags) });
```

Invalidation is idempotent, so Webflow's retries (up to 3, 10 minutes apart, after any non-200) are harmless.

### Collections that were never published

Webflow answers 404 on the live items of a collection that exists but was never published. next-webflow treats it as empty: `getItems` returns `[]` and `getItemBySlug` returns `null` (a missing collection still throws). Pages rendered this way keep the collection's cache tags, so the first site publish refreshes them.

### Known Webflow behavior: deleted items linger in live lists

After you delete a published item, Webflow's `/items/live` list (and `?slug=` lookups) keeps returning it until the next site publish, even though the item itself returns 404 (measured on 2026-10-21: still listed after 10 minutes). next-webflow invalidates on the delete webhook, but the refetch gets the same stale list from Webflow. **Workaround:** publish the site after deleting items. The `site_publish` webhook then invalidates everything, and the item disappears. This is Webflow's behavior, not something next-webflow requires.

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
- **Videos and embedded posts** (YouTube, Vimeo, tweets: Webflow stores them all as video figures) render at their aspect ratio without Webflow's CSS: next-webflow replaces Webflow's inline `padding-bottom` with `aspect-ratio` from the figure's dimensions and sizes the iframe to fill it. Webflow's classes (`w-richtext-figure-type-video`, `w-richtext-align-center`…) stay on the elements, so webflow.css or your own styles can still target them, and a `figure` override in `components` receives them (`className`, adjusted `style`). Embedded posts keep the ratio Webflow stores (a tweet is 500:281), so on narrow screens their card is cut off; render them with your own component through `components.figure` (the original URL is in `data-page-url`).
- **Images in Rich Text fit their container** (`max-width:100%; height:auto`; Webflow's `width="auto"` attributes are dropped), so large uploads don't overflow without Webflow's CSS.
- **Code blocks come back empty.** Webflow's API returns a Rich Text code block as an empty `<pre></pre>`, even one created in the editor (Webflow's docs say the API doesn't support code blocks). For code samples, use an HTML embed with `<pre><code>` (paid Webflow plans) or a separate field.
- **Image alignment still needs CSS.** Centered, floated and full-width images are `<figure class="w-richtext-figure-type-image w-richtext-align-center|floatleft|floatright|fullwidth">`; Webflow's CSS lays them out. Style those classes yourself or load your site's webflow.css. [`examples/blog/app/globals.css`](https://github.com/crashncrow/next-webflow/blob/main/examples/blog/app/globals.css) shows the rules, commented; with Tailwind, see below.
- **Sanitized by default.** The Data API returns Rich Text HTML exactly as it was stored, including `<script>` elements and event handlers (`onclick`, `onerror`…): Webflow doesn't sanitize it, and anyone who can edit the CMS (or holds a token with CMS write access) can put them there. Treat it as untrusted input. `WebflowRichText` sanitizes it by default; if you render the field some other way (e.g. `dangerouslySetInnerHTML`), sanitize it yourself first. `WebflowRichText` removes `<script>`, `<object>`, `<embed>`, `<base>`, `<meta>`, every `on*` attribute, `srcdoc`, `javascript:` / `vbscript:` / `data:` URLs (in `href`, `src`, `action`, `formaction`, `xlink:href`, `srcset`, SVG animation values…) and styles with `javascript:` / `expression()`. Iframes with normal URLs (YouTube, Vimeo) and code embeds without scripts still render.
- `allowScripts` turns sanitizing off for that render. **Don't enable it for all content** to make a tweet or an Instagram post work: replace those embeds with a React component through `components` (e.g. detect `blockquote.twitter-tweet` and render your `<Tweet id>`). React 19 blocks `javascript:` links even then.

#### With Tailwind CSS

The [typography plugin](https://github.com/tailwindlabs/tailwindcss-typography) styles headings, lists, quotes, figures and captions out of the box. Pass its classes to `WebflowRichText` (they replace the default `w-richtext` class), and target Webflow's alignment classes with arbitrary variants:

```css
/* app/globals.css (Tailwind v4) */
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```

```tsx
<WebflowRichText
  html={post.fieldData.body}
  className="prose lg:prose-lg dark:prose-invert max-w-none [&_pre:empty]:hidden [&_.w-richtext-align-center]:mx-auto [&_.w-richtext-align-floatleft]:float-left [&_.w-richtext-align-floatleft]:mr-6 [&_.w-richtext-align-floatright]:float-right [&_.w-richtext-align-floatright]:ml-6"
/>
```

`[&_pre:empty]:hidden` hides the empty box Webflow's API returns for code blocks. Checked with Tailwind 4.3 and `@tailwindcss/typography` 0.5.20 on a real post (headings, lists, captions, quotes, videos).

### `WebflowImage`

```tsx
import { WebflowImage } from "next-webflow/components";

<WebflowImage image={post.fieldData.mainImage} width={1200} height={630} sizes="100vw" style={{ maxWidth: "100%", height: "auto" }} />
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

**tsconfig.** Nothing to register: types flow from `webflow/schema.ts` through the functions `webflow/index.ts` exports, so the generated files only need to be inside your project (they are, unless you exclude them). Without a generated schema, `createWebflow()` returns untyped functions that accept a generic: `getItems<MyFields>("posts")`.

## Known limitations

Webflow behavior, measured on 2026-10-21, and how next-webflow handles it:

- **Deleted items linger in live lists until the next site publish.** See [above](#known-webflow-behavior-deleted-items-linger-in-live-lists); publish the site after deleting.
- **Collections never published** return 404 from Webflow; next-webflow returns an empty list ([details](#collections-that-were-never-published)).
- **Rich Text code blocks come back empty** (`<pre></pre>`) from the API, even when created in the editor.
- **Rich Text images without their own alt text** inherit the asset's alt text on Webflow's site; next-webflow renders them as decorative (`alt=""`) and warns in development. Set alt text on the image in the editor.
- **Embedded posts (tweets) in Rich Text** have a fixed aspect ratio and get cut off on narrow screens; render them with your own component.
- **Image dimensions aren't in the API**, so `WebflowImage` needs `width`/`height` or `fill`. Webflow's CDN doesn't resize images.
- **Rate limits:** 60 requests per minute on Starter and Basic plans, 120 on CMS, eCommerce and Business (Webflow's docs; our Starter test site reported 150, so next-webflow never hard-codes a limit). Cached reads don't count; builds read one list per collection.
- **Sorting** only by `createdOn`, `lastPublished`, `lastUpdated`, `name` or `slug`; sort by custom fields in your code.
- **`include` is one level deep.** Above `maxIncludeItems` (1,000) referenced items are fetched by ID.
- Not supported: writing to the CMS, ecommerce, the Pages and Designer APIs, frameworks other than Next.js.

## Webflow Cloud notes (preview)

Measured on Webflow Cloud on 2026-10-21 (Next.js 16.4, `@opennextjs/cloudflare` 1.20). Full measurements: [Webflow Cloud spike](https://github.com/crashncrow/next-webflow/blob/main/docs/webflow-cloud-spike.md).

- **Caching doesn't work by default: add a KV-backed `open-next.config.ts`.** Without one, Webflow's builder generates a config with dummy caches: there's no data cache (every request hits Webflow's API) and `revalidateTag` does nothing. Commit this file and the bindings, and Cloud provisions the KV namespace and the D1 database:

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
    "d1_databases": [{ "binding": "NEXT_TAG_CACHE_D1", "database_name": "next-tag-cache", "database_id": "0", "migrations_dir": "migrations" }]
  }
  ```

  ```sql
  -- migrations/0001_revalidations.sql (the table OpenNext's D1 tag cache uses)
  CREATE TABLE IF NOT EXISTS revalidations (tag TEXT NOT NULL, revalidatedAt INTEGER NOT NULL, stale INTEGER, expire INTEGER default NULL, UNIQUE(tag) ON CONFLICT REPLACE);
  ```

  With it, cached reads hit across isolates and a webhook's invalidation is visible about 1 s later. **`webflow apps deploy` deletes `open-next.config.ts` from your working copy after deploying** (the deploy itself used it): restore it with `git checkout -- open-next.config.ts` before the next local deploy (CI checkouts are unaffected).
- **Set `NEXT_PUBLIC_BASE_PATH` to the app's mount path** (e.g. `/app`), as Webflow's docs recommend. Route handlers on Cloud don't see the mount path in the request URL, so the draft route uses this variable for its redirects (`basePath` in `createDraftHandler` overrides it). `next/link` adds the base path by itself; plain `<a>`, `<img>` and `fetch` URLs to your own app need it.
- **Don't add `export const runtime = "edge"` to route handlers.** Webflow's docs say API routes need the edge runtime, but in our tests every edge route returned `500 Internal Server Error`, while the same handlers on the default Node.js runtime worked. next-webflow's route handlers (webhook, draft) don't export `runtime`.
- **Upload secrets with `webflow apps env-vars import <file> --secret`, and keep them out of every `.env*` file before deploying.** That means files of any mode (`.env`, `.env.local`, `.env.production`, `.env.development.local`, `.env.test`…), in the app directory and, if the app is part of a monorepo, at its root (the nearest parent folder with a lockfile). Keep local values in a file not named `.env*` (e.g. `local.env`).
- **Clear the build's data cache before deploying.** The CLI builds in your working copy and reuses `.next/cache/fetch-cache` from earlier local builds, so prerendered pages can contain data from an old build. Delete `.next/cache/fetch-cache` before `webflow apps deploy` (deploying from CI with a fresh checkout avoids it).
- **CMS images are served at their original size** (see [`WebflowImage`](#webflowimage)): upload pre-optimized images.
- **Builds don't see Cloud's variables.** The CLI builds locally, so `generateStaticParams` and other build-time reads need `WEBFLOW_CMS_TOKEN` in the deploy shell's environment (e.g. `set -a; . ./local.env; set +a` before `webflow apps deploy`, with the values in a file not named `.env*`).

## Example app

[`examples/blog`](https://github.com/crashncrow/next-webflow/tree/main/examples/blog): a list page with authors and categories, post pages with `generateStaticParams`, Rich Text with an override, webhooks, signed draft previews, a password-protected drafts page, and commented CSS for Webflow's Rich Text classes.

## License

MIT © Diego Gennaro
