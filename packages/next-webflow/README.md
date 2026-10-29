# next-webflow

Use the **Webflow CMS as a headless content source in Next.js** (App Router, Next 15 and 16): types generated from your site, cached reads that refresh when you publish, signed draft previews, and components for Rich Text and images.

> **Beta:** APIs may still change before `0.1.0`. Webflow Cloud support is a [preview](https://github.com/crashncrow/next-webflow/blob/main/docs/webflow-cloud.md).

**Contents:** [Quick start](#quick-start) · [Reading content](#reading-content) · [Keeping pages fresh](#keeping-pages-fresh) · [Draft previews](#draft-previews) · [Rendering](#rendering) · [Setup reference](#setup-reference) · [Known limitations](#known-limitations) · [Webflow Cloud](#webflow-cloud-preview) · [Agent skill](#agent-skill)

## Quick start

Requirements: Next.js 15 or 16 with the App Router, React 19, Node.js 22.12+.

**1. Install**

```bash
npm install next-webflow
```

**2. Add your site's credentials** to `.env.local`: a site token with **CMS: Read** (Site settings → Apps & integrations → API access) and the site ID (Site settings → General).

```bash
WEBFLOW_CMS_TOKEN=…
WEBFLOW_SITE_ID=…
```

**3. Generate the typed client.**

```bash
npx next-webflow typegen
```

It writes `webflow/schema.ts` and `webflow/index.ts`. With a `src/` directory, add `--out src/webflow`.

**4. Read content** in a Server Component. The `@/` alias comes with `create-next-app`; otherwise import with a relative path.

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

**5. Refresh pages when you publish.** Add the webhook route, deploy, then [register the webhooks](#webhooks) once with `npx next-webflow webhooks register`. Registering needs a separate token with more scopes ([Tokens](#tokens-and-scopes)).

```ts
// app/api/webflow/route.ts
export { POST } from "next-webflow/webhook";
```

**6. Optional:** [draft previews](#draft-previews) and [components](#rendering). The [example blog](https://github.com/crashncrow/next-webflow/tree/main/examples/blog) puts it all together.

## Reading content

```ts
import { getItems, getItemBySlug, getItem } from "@/webflow";

const posts = await getItems("posts", {
  filter: { featured: { eq: true } },
  sortBy: "lastPublished",
  sortOrder: "desc",
  limit: 10, // default: every item; pages of 100 are fetched for you
});
const post = await getItemBySlug("posts", "hello-world"); // or null
const byId = await getItem("posts", itemId); // or null
```

| Option                | Applies to |                                                                                                                                   |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `filter`              | `getItems` | Keyed by field (camelCase or API slug). Operators: `eq ne gt gte lt lte in nin contains ncontains exists`.                        |
| `sortBy`, `sortOrder` | `getItems` | `createdOn`, `lastPublished`, `lastUpdated`, `name` or `slug`. Sorting by your own fields isn't supported yet: sort in your code. |
| `limit`, `offset`     | `getItems` | Without `limit`, every item.                                                                                                      |
| `include`             | all        | Replace Reference fields with the referenced items. See [References](#references-include).                                        |
| `cmsLocaleId`         | all        | Read a secondary locale (default: the primary one).                                                                               |
| `raw: true`           | all        | The API's item untouched: slug keys, Option IDs, `null` for empty fields.                                                         |
| `signal`              | all        | An `AbortSignal`.                                                                                                                 |

- A missing item is `null`. Everything else throws a subclass of `WebflowError` ([list](https://github.com/crashncrow/next-webflow/blob/main/docs/details.md#errors-and-retries)); rate limits and server errors are retried first.
- In [draft mode](#draft-previews) the same calls return staged content.
- If someone changes a collection after you ran typegen, next-webflow keeps serving the data and warns once. Run `typegen --check` in CI to know when your types are behind the site.

### Field values

Items are normalized: `fieldData` keys are camelCase (`main-image` → `mainImage`), empty fields are absent, and optional fields are typed optional.

| Webflow type                          | Value                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| Plain text, Link, Email, Phone, Color | `string`                                                                                   |
| Rich text                             | `string`: HTML, **unsanitized**. Render it with [`WebflowRichText`](#webflowrichtext).     |
| Number                                | `number`                                                                                   |
| Switch                                | `boolean`                                                                                  |
| Date/Time                             | `string` (ISO 8601)                                                                        |
| Option                                | `{ id, name }`, typed as the exact pairs from your schema; `name: undefined` if unknown    |
| Image, File                           | `{ fileId, url, alt }` (`WebflowImageValue`, `WebflowFileValue`); `alt` may be `null`      |
| Multi-image                           | `WebflowImageValue[]`                                                                      |
| Video link                            | `{ url, metadata? }` (`WebflowVideoValue`)                                                 |
| Reference                             | The item ID (`string`), or with [`include`](#references-include) the item (`Item \| null`) |
| Multi-reference                       | The item IDs (`string[]`), or with [`include`](#references-include) the items (`Item[]`)   |
| External file reference               | `unknown`, as returned (typegen warns)                                                     |

**Options.** Compare by `id` (stable) and display `name`. Editors can rename options: the new name shows on your site without rerunning typegen, at the latest after the next site publish ([how](https://github.com/crashncrow/next-webflow/blob/main/docs/details.md#option-names)). Set `optionNames: "generated"` to use only the names from typegen.

**Video links.** `url`, plus `metadata` from Embedly (`thumbnailUrl`, `aspectRatio`…; every key is optional and varies by provider). `metadata.html` is third-party iframe HTML: next-webflow never renders it, and you shouldn't without trusting Embedly and the provider. Prefer your own player from `url`.

### References (`include`)

```ts
const posts = await getItems("posts", { include: ["author", "coAuthors"] });
posts[0].fieldData.author; // AuthorsItem | null
posts[0].fieldData.coAuthors; // AuthorsItem[]
```

- One level deep, on `getItems`, `getItemBySlug` and `getItem`. Fields you don't include keep their IDs.
- A missing or unpublished item is `null` (Reference) or left out (Multi-reference). `raw: true` keeps the IDs and can't be combined with `include`.
- Small collections (up to `maxIncludeItems`, 1,000) are read once and cached; larger ones only fetch the items the page uses ([cost](https://github.com/crashncrow/next-webflow/blob/main/docs/details.md#references-include)).

## Keeping pages fresh

### Caching and tags

Every read is cached by Next.js with tags, so pages stay static until a tag is invalidated:

| Tag                                 | On                                                   | Invalidated by                   |
| ----------------------------------- | ---------------------------------------------------- | -------------------------------- |
| `webflow`                           | every read                                           | `site_publish`                   |
| `webflow:collection:<collectionId>` | lists, slug lookups, `include` of a whole collection | any CMS event in that collection |
| `webflow:item:<itemId>`             | `getItem`, `include` by ID                           | CMS events for that item         |

- After a webhook, the next request fetches fresh content (`revalidateTag(tag, { expire: 0 })`). Set the webhook handler's [`profile`](#webhook-handler-options) to `"max"` to serve stale content while revalidating instead.
- Renaming a slug refreshes the old URL too (it then returns `null` → `notFound()`), because slug lookups carry the collection tag. The trade-off: any change in a collection refreshes all its cached slug lookups on their next visit.
- During `next build`, `getItemBySlug` reads the cached list instead of one request per page: about one request per 100 items ([numbers](https://github.com/crashncrow/next-webflow/blob/main/docs/details.md#builds-generatestaticparams)). For very large collections, prerender a subset and let `dynamicParams` render the rest.
- Draft mode bypasses the cache. To read uncached on purpose, use `createWebflowCms({ schema })` from `next-webflow` instead of `createWebflow`.

### Webhooks

```ts
// app/api/webflow/route.ts (don't export `runtime`)
export { POST } from "next-webflow/webhook";
```

```bash
npx next-webflow webhooks register --url https://your-site.com/api/webflow --token-env WEBFLOW_ADMIN_TOKEN
npx next-webflow webhooks list
npx next-webflow webhooks unregister --url https://your-site.com/api/webflow
```

`register` creates signed webhooks for every CMS event and `site_publish`, and writes their secrets to `WEBFLOW_WEBHOOK_SECRET` in `.env.local` (`--env <path>` for another file, `--print` to only print them). Add that variable to your host too: Webflow shows each secret only once. It needs a separate token with more scopes ([Tokens](#tokens-and-scopes)).

| Event                                                     | Invalidates                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `collection_item_published` / `_unpublished` / `_deleted` | the item and its collection                                      |
| `collection_item_created` / `_changed`                    | the item and its collection, **except** staged edits (`isDraft`) |
| `site_publish`                                            | everything                                                       |

- Requests are **verified**: HMAC signature of the raw body, messages older than 5 minutes rejected. Unsigned requests get 401, because webhooks created in Webflow's dashboard aren't signed: register them with the command.
- When unsure whether an event is a draft, the handler invalidates: a wrong guess costs a refetch, never stale content. Invalidation is idempotent, so Webflow's retries are harmless.

#### Webhook handler options

To log events or change what's invalidated, use `createWebhookHandler(options)`:

```ts
// app/api/webflow/route.ts
import { createWebhookHandler } from "next-webflow/webhook";

export const POST = createWebhookHandler({ onEvent: (event, tags) => console.log(event.triggerType, tags) });
```

| Option                      | Default                  |                                                                         |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `secret`                    | `WEBFLOW_WEBHOOK_SECRET` | One or several (comma-separated in the variable): any of them verifies. |
| `profile`                   | `{ expire: 0 }`          | Passed to `revalidateTag`; `"max"` serves stale while revalidating.     |
| `invalidateOnStagedChanges` | `false`                  | Also invalidate on draft edits.                                         |
| `extraTags(event)`          | —                        | Tags to add to the default mapping.                                     |
| `tags(event, defaults)`     | —                        | Replace the tag list (receives the defaults plus `extraTags`).          |
| `onEvent(event, tags)`      | —                        | Logging, notifications. Throwing returns 500, so Webflow retries.       |
| `logger`, `toleranceMs`     | `console`, 5 minutes     | Where warnings go; maximum age of a signed request, in milliseconds.    |
| `allowUnsigned`             | `false`                  | Accept unsigned requests. Insecure: anyone can invalidate your cache.   |

### Data API or CDN

|                            | `source: "data"` (default)                              | `source: "cdn"`                                                                             |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Reads from                 | Data API, `/items/live`                                 | Content Delivery API (`api-cdn.webflow.com`)                                                |
| Freshness after publishing | Immediate, with webhooks                                | Up to 5 minutes (2 on Enterprise): Webflow doesn't purge the CDN on publish                 |
| Rate limit                 | Every cache miss counts (the limit depends on the plan) | CDN cache hits don't count                                                                  |
| Use it when                | You registered webhooks (recommended)                   | No webhooks, very large builds, or rate limits are tight and a few minutes of delay is fine |

With `cdn` and webhooks together, a webhook can refetch before the CDN has the new content and cache the old version again; prefer `data` with webhooks. Draft mode always uses the Data API. Set `source` in [`createWebflow`](#createwebflow-options).

## Draft previews

Previews use **signed links that expire**; the secret never appears in a URL. A link names a collection and an item ID (so it survives slug changes); the route reads the staged item, turns on Next.js draft mode and redirects to the item's page. While draft mode is on, every read returns staged content, uncached.

```ts
// app/api/webflow/draft/route.ts (don't export `runtime`)
import { createDraftHandler } from "next-webflow/draft";
import { schema } from "@/webflow/schema";

export const { GET, DELETE } = createDraftHandler({
  schema,
  resolvePath: (collection, item) => `/posts/${item.fieldData.slug}`, // required
});
```

- Set `WEBFLOW_PREVIEW_SECRET` to a long random string.
- Links last 1 hour by default; links claiming more than 30 days are rejected.
- Leave preview with `GET /api/webflow/draft?disable=1&path=/posts/hello-world` (redirects to that same-site path) or `DELETE`. [`DraftModeBanner`](#draftmodebanner) adds the exit link for you.

`createDraftHandler` options:

| Option                   | Default                                                       |                                                                   |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `resolvePath`            | — (required)                                                  | `(collection, item) => path` of the item's page.                  |
| `schema`                 | —                                                             | The generated schema.                                             |
| `secret`                 | `WEBFLOW_PREVIEW_SECRET`                                      | One or several, to rotate: any of them verifies, the first signs. |
| `basePath`               | `NEXT_PUBLIC_BASE_PATH`, else the `basePath` in `next.config` | Prefixed to redirects ([Webflow Cloud](#webflow-cloud-preview)).  |
| `maxLinkLifetimeSeconds` | 30 days                                                       | Reject links that claim to last longer.                           |
| `logger`                 | `console`                                                     | Where warnings go.                                                |

### Making preview links

- **On the server:** `createPreviewUrl({ url, collection, itemId })` (it needs the secret). Also takes `expiresIn` (seconds, default 3600) and `secret`.
- **From a terminal:** `npx next-webflow preview-url`.
- **For editors:** a page listing drafts with their links. Copy [`proxy.ts`](https://github.com/crashncrow/next-webflow/blob/main/examples/blog/proxy.ts) and [`app/drafts/page.tsx`](https://github.com/crashncrow/next-webflow/blob/main/examples/blog/app/drafts/page.tsx) from the example. Both check a password (`DRAFTS_PASSWORD`; without it the page answers 503 to everyone), so a wrong proxy `matcher` doesn't expose it.

> **Warning: `unsafeStagedCache` publishes your drafts on any page that uses it.** The drafts page uses it to read staged content without draft mode. Only use it on a password-protected page; never on a public page or with static rendering.

### `DraftModeBanner`

```tsx
// app/layout.tsx, inside <body>
import { DraftModeBanner } from "next-webflow/components";

<DraftModeBanner />; // route="/api/webflow/draft" by default
```

Renders only in draft mode: a fixed bar with an "Exit preview" link back to the current page. Props: `route` (your draft route), `children` (the message), `exitLabel`, `className` (replaces the default inline styles), `exitClassName` (the exit link) and `basePath`.

## Rendering

Server Components from `next-webflow/components`. It's the only entry point with dependencies (`html-react-parser`, MIT); nothing is added to the browser bundle.

### `WebflowRichText`

```tsx
import { WebflowRichText } from "next-webflow/components";

<WebflowRichText
  html={post.fieldData.body}
  components={{ blockquote: MyQuote }} // replace elements by tag
  webflowComponents={{ Callout: MyCallout }} // <wf-component name="Callout"> → your component
/>;
```

- **Sanitized by default.** The Data API returns Rich Text HTML exactly as stored, including `<script>` elements and event handlers (`onclick`…): anyone who can edit the CMS can put them there. `WebflowRichText` removes them, along with dangerous URLs and embeds ([full list](https://github.com/crashncrow/next-webflow/blob/main/docs/details.md#rich-text-sanitizing)). If you render the field another way (e.g. `dangerouslySetInnerHTML`), sanitize it yourself. `allowScripts` turns this off: don't use it to make tweets or Instagram posts work; replace those embeds with your own component through `components`.
- Same-site links render with `next/link`; others stay `<a>`.
- Webflow components inside Rich Text (`<wf-component>`) render through `webflowComponents` by name, with their props and rendered slots. Unmapped ones render their text and warn in development.
- Videos and embedded posts keep their aspect ratio, and images fit their container, without Webflow's CSS ([how](https://github.com/crashncrow/next-webflow/blob/main/docs/details.md#rich-text-layout)). Images stay `<img>` (Webflow doesn't give their size); override `img` to change that.
- **Image alignment needs CSS.** Centered, floated and full-width images use Webflow's classes (`w-richtext-align-center|floatleft|floatright|fullwidth`): style them or load your site's webflow.css. [The example's CSS](https://github.com/crashncrow/next-webflow/blob/main/examples/blog/app/globals.css) shows the rules.

With Tailwind's [typography plugin](https://github.com/tailwindlabs/tailwindcss-typography) (`@plugin "@tailwindcss/typography"` in your CSS), pass its classes and target the alignment classes (`[&_pre:empty]:hidden` hides [empty code blocks](#known-limitations)):

```tsx
<WebflowRichText
  html={post.fieldData.body}
  className="prose lg:prose-lg dark:prose-invert max-w-none [&_pre:empty]:hidden [&_.w-richtext-align-center]:mx-auto [&_.w-richtext-align-floatleft]:float-left [&_.w-richtext-align-floatleft]:mr-6 [&_.w-richtext-align-floatright]:float-right [&_.w-richtext-align-floatright]:ml-6"
/>
```

### `WebflowImage`

```tsx
import { WebflowImage } from "next-webflow/components";

<WebflowImage image={post.fieldData.mainImage} width={1200} height={630} sizes="100vw" style={{ maxWidth: "100%", height: "auto" }} />
<WebflowImage image={post.fieldData.mainImage} fill sizes="50vw" /> {/* parent: position relative + size */}
```

- The types require `width` + `height`, or `fill`: the API doesn't give image dimensions ([Known limitations](#known-limitations)).
- `alt` comes from the field; pass `alt` to override. An empty or inherited alt renders as decorative (`alt=""`) with a development warning.
- Allow Webflow's asset CDN in `next.config.ts`:

  ```ts
  images: { remotePatterns: [{ protocol: "https", hostname: "cdn.prod.website-files.com" }] },
  ```

- Next.js' optimizer resizes images on Vercel or `next start`. On Webflow Cloud, images are served at their original size: [upload pre-optimized images](https://github.com/crashncrow/next-webflow/blob/main/docs/webflow-cloud.md#images).

## Setup reference

### Tokens and scopes

next-webflow reads **`WEBFLOW_CMS_TOKEN`**, a site token (Site settings → Apps & integrations → API access). It never reads `WEBFLOW_API_TOKEN`, the Webflow CLI's variable.

| Used by                                                    | Token                                                        | Scopes                            |
| ---------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------- |
| Your app at runtime and builds, `npx next-webflow typegen` | `WEBFLOW_CMS_TOKEN`                                          | CMS: Read (read-only)             |
| `npx next-webflow webhooks register / list / unregister`   | a separate token, e.g. via `--token-env WEBFLOW_ADMIN_TOKEN` | Sites: Read and write + CMS: Read |

Keep the runtime token read-only. Every CLI command also accepts `--token <value>`, but `--token-env` keeps it out of your shell history.

### Types (`typegen`)

```bash
npx next-webflow typegen          # reads WEBFLOW_CMS_TOKEN + WEBFLOW_SITE_ID (env or .env.local; --env <path> for another file)
npx next-webflow typegen --check  # CI: exit 1 if webflow/schema.ts no longer matches the site
```

It writes two files in `webflow/` (`--out` to change it):

- **`schema.ts`** is regenerated on every run; don't edit it. It describes your collections and has one type per collection: `posts` → `PostsItem`, `blog-posts` → `BlogPostsItem`, `2024-events` → `Collection2024EventsItem`.
- **`index.ts`** is created once and then belongs to you (`--force` recreates it). Put [client options](#createwebflow-options) and friendlier type names here:

```ts
// webflow/index.ts
import { createWebflow } from "next-webflow";
import { schema, type PostsItem } from "./schema";

export const { getItems, getItemBySlug, getItem } = createWebflow({ schema, source: "cdn" });
export type * from "./schema";
export type Post = PostsItem;
```

Then import from your folder: `import { getItems, type Post } from "@/webflow"`. `--check` ignores formatting, so Prettier is fine. Without a generated schema, `createWebflow()` returns untyped functions that accept a generic: `getItems<MyFields>("posts")`.

### `createWebflow` options

| Option                      | Default        |                                                                                         |
| --------------------------- | -------------- | --------------------------------------------------------------------------------------- |
| `schema`                    | —              | The generated schema.                                                                   |
| `source`                    | `"data"`       | `"cdn"` reads published items from Webflow's CDN ([Data API or CDN](#data-api-or-cdn)). |
| `optionNames`               | `"live"`       | `"generated"`: Option names only from typegen ([Field values](#field-values)).          |
| `maxIncludeItems`           | `1000`         | Above it, `include` fetches referenced items by ID.                                     |
| `maxBuildListItems`         | `5000`         | Warn above it during builds.                                                            |
| `buildSlugLookups`          | `"list"`       | `"request"`: one `?slug=` request per page during builds.                               |
| `retry`                     | 3 retries      | `{ maxRetries, baseDelayMs, maxDelayMs, maxRetryAfterMs }`, or `false`.                 |
| `concurrency`               | `4`            | Maximum parallel requests.                                                              |
| `token`, `siteId`, `logger` | env, `console` | Instead of `WEBFLOW_CMS_TOKEN`, `WEBFLOW_SITE_ID` and `console`.                        |

## Known limitations

**Webflow behavior**, and how next-webflow handles it ([details](https://github.com/crashncrow/next-webflow/blob/main/docs/details.md#known-webflow-behavior)):

- **Deleted items linger in live lists until the next site publish.** Publish the site after deleting items.
- **Collections never published** return 404 from Webflow, and every live read of a **site never published** returns 409; in both cases next-webflow returns an empty list (or `null` for a single item).
- **Webflow sends no webhook when a collection's structure changes.** Renamed and added options still show correctly; rerun typegen to update your types.
- **Rich Text code blocks come back empty** (`<pre></pre>`), even when created in the editor. Use an HTML embed with `<pre><code>` (paid plans) or a separate field.
- **Images without their own alt text** inherit the asset's alt text on Webflow's site; next-webflow renders them as decorative (`alt=""`) and warns in development. Set alt text on the image in the editor.
- **Embedded posts (tweets) in Rich Text** have a fixed aspect ratio and get cut off on narrow screens; render them with your own component through `components.figure` (the URL is in `data-page-url`).
- **Image dimensions aren't in the API**, and Webflow's CDN doesn't resize images.
- **Rate limits** depend on the plan ([numbers](https://github.com/crashncrow/next-webflow/blob/main/docs/details.md#known-webflow-behavior)). Cached reads don't count, and builds read each collection's list once (about one request per 100 items).

**Not supported by next-webflow:**

- **Sorting by your own fields** (Webflow's API allows it; not exposed yet): `sortBy` takes `createdOn`, `lastPublished`, `lastUpdated`, `name` or `slug`. Sort in your code.
- **References more than one level deep** ([`include`](#references-include)).
- Writing to the CMS, ecommerce, the Pages and Designer APIs, frameworks other than Next.js.

## Webflow Cloud (preview)

next-webflow runs on Webflow Cloud with some setup. Read the [Webflow Cloud guide](https://github.com/crashncrow/next-webflow/blob/main/docs/webflow-cloud.md) before deploying. In short:

- Add a KV + D1 cache configuration: without it there's no data cache and webhooks can't refresh pages.
- Set `NEXT_PUBLIC_BASE_PATH` to the app's mount path, and don't export `runtime = "edge"` from route handlers.
- Keep secrets out of every `.env*` file when deploying: they end up inside the deployed code.

## Agent skill

For AI coding agents, the repository has a [`next-webflow` skill](https://github.com/crashncrow/next-webflow/blob/main/skills/next-webflow/SKILL.md) with setup steps, rules, recipes and troubleshooting: `npx skills add crashncrow/next-webflow`.

## License

This project is licensed under the [MIT License](https://github.com/crashncrow/next-webflow/blob/main/LICENSE).

---

<p align="center">
  <sub>Made with 🧉 by <a href="https://nnaro.dev">nnaro.dev</a></sub>
</p>
