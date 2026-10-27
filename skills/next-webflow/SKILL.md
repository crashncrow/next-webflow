---
name: next-webflow
description: Use the Webflow CMS as a headless content source in a Next.js App Router app with the next-webflow library. Use when adding Webflow content to a Next.js page, setting up next-webflow (credentials, typegen, webhooks, draft previews), rendering Webflow Rich Text or images, or debugging stale content, missing types, 401 webhooks or preview links in a project that depends on next-webflow.
license: MIT
metadata:
  author: "Diego Gennaro"
  repository: "https://github.com/crashncrow/next-webflow"
---

# next-webflow

Reads Webflow CMS content in Next.js 15/16 (App Router, React 19, Node.js 22.12+): a typed client generated from the site, reads cached with tags, webhooks that invalidate exactly what changed, signed draft previews, and safe Rich Text and image components.

The full guide is the package README (`node_modules/next-webflow/README.md`). Read the section you need before writing code; this skill is the short version plus the rules agents most often get wrong.

## First, check the project

1. `package.json` has `next-webflow`, and `next` is 15 or 16 with an `app/` directory. Pages Router or another framework: stop and say next-webflow doesn't support it.
2. Find the generated client: a `webflow/` (or `src/webflow/`) folder with `schema.ts` and `index.ts`. If it's missing, run typegen (below) before writing pages.
3. Read `webflow/schema.ts` for the real collection slugs and field names. **Never guess a collection or field name**; the types reject unknown slugs.

## Setup (only the steps that are missing)

1. Install: `npm install next-webflow`.
2. `.env.local`: `WEBFLOW_CMS_TOKEN` (site token, **CMS: Read** only) and `WEBFLOW_SITE_ID`. Ask the user to add them; never ask for the values, never write tokens into source files or commit them.
3. Typegen: `npx next-webflow typegen` (`--out src/webflow` if the project uses `src/`). Writes `schema.ts` (regenerated every run, never edit it) and `index.ts` (created once, then owned by the user).
4. Webhook route, then the user registers webhooks once after deploying (see Webhooks).
5. Optional: draft previews, components, `typegen --check` in CI.

## Rules

- **Import reads from the generated folder**, not from the package: `import { getItems, getItemBySlug, getItem } from "@/webflow"`.
- **Route handlers never export `runtime`.** `runtime = "edge"` returns 500 on Webflow Cloud; the default runtime works everywhere.
- **Don't use `"use cache"`** for Webflow reads, and don't wrap them in your own cache: next-webflow already caches with `fetch` tags. To read uncached on purpose, use `createWebflowCms({ schema })` from `next-webflow`.
- **If you call `revalidateTag` yourself, pass two arguments**: `revalidateTag(tag, { expire: 0 })` (Next 16 signature; Next 15 ignores the second).
- **The env var is `WEBFLOW_CMS_TOKEN`.** `WEBFLOW_API_TOKEN` is never read (it's the Webflow CLI's variable; exporting a site token under that name breaks `webflow apps deploy`).
- **Keep the runtime token read-only.** `webhooks register` / `list` / `unregister` need a separate token with **Sites: Read and write + CMS: Read**: always pass `--token-env WEBFLOW_ADMIN_TOKEN` (without it the CLI uses `WEBFLOW_CMS_TOKEN` and Webflow answers 401/403). Never fix that error by adding write scopes to `WEBFLOW_CMS_TOKEN`, and never use `--token <value>` (shell history). `WEBFLOW_ADMIN_TOKEN` stays on the developer's machine: document it as a comment in `.env.example`, never as a variable to deploy.
- **Render Rich Text with `WebflowRichText`.** The Data API returns stored HTML including `<script>` and event handlers. Never use `dangerouslySetInnerHTML` on a Rich Text field, and don't set `allowScripts` to make embeds work; replace embeds through `components`.
- **Never render `video.metadata.html`** (third-party iframe HTML). Build a player from `url`.
- **Never use `unsafeStagedCache` on a public or statically rendered page.** It publishes drafts.
- Handle `null`: `getItemBySlug` / `getItem` return `null` for a missing item (call `notFound()`), a Reference with `include` can be `null`, and an unknown Option has `name: undefined`.

## Recipes

**List and detail pages**

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

- `getItems(collection, { filter, sortBy, sortOrder, limit, offset, include, cmsLocaleId, raw })`. `sortBy` only accepts `createdOn`, `lastPublished`, `lastUpdated`, `name`, `slug`; next-webflow doesn't expose sorting by custom fields yet, so sort those in code. Without `limit` it returns every item.
- `fieldData` keys are camelCase (`main-image` → `mainImage`); empty fields are absent, not `null`.
- Options are `{ id, name }`: compare by `id`, display `name`.

**References:** `getItems("posts", { include: ["author"] })` → `author: AuthorsItem | null`. One level deep. `raw: true` can't be combined with `include`.

**Images:** `<WebflowImage image={post.fieldData.mainImage} width={1200} height={630} sizes="100vw" />` or `fill` (Webflow doesn't report dimensions, so one of the two is required). Add `cdn.prod.website-files.com` to `images.remotePatterns` in `next.config.ts`.

**Webhooks**

```ts
// app/api/webflow/route.ts (no `runtime` export)
export { POST } from "next-webflow/webhook";
```

Then the user runs, after deploying: `npx next-webflow webhooks register --url https://<site>/api/webflow --token-env WEBFLOW_ADMIN_TOKEN`. It writes `WEBFLOW_WEBHOOK_SECRET` to `.env.local`; the user must also add it to the host (Webflow shows each secret once). For logging or custom tags use `createWebhookHandler(options)`.

**Draft previews**

```ts
// app/api/webflow/draft/route.ts (no `runtime` export)
import { createDraftHandler } from "next-webflow/draft";
import { schema } from "@/webflow/schema";

export const { GET, DELETE } = createDraftHandler({
  schema,
  resolvePath: (collection, item) => `/posts/${item.fieldData.slug}`, // must match the real route
});
```

Needs `WEBFLOW_PREVIEW_SECRET` (long random string). Add `<DraftModeBanner />` inside `<body>` in `app/layout.tsx`. Links come from `createPreviewUrl({ url, collection, itemId })` on the server or `npx next-webflow preview-url`.

## Troubleshooting

| Symptom                                    | Cause and fix                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Type error on a collection or field name   | Name guessed or schema stale: read `webflow/schema.ts`; rerun `npx next-webflow typegen`.                                          |
| Content doesn't update after publishing    | Webhooks not registered, or `WEBFLOW_WEBHOOK_SECRET` missing on the host. With `source: "cdn"`, up to 5 minutes delay is expected. |
| Webhook returns 401                        | Webhooks created in Webflow's dashboard aren't signed: register them with the CLI.                                                 |
| `webhooks register` fails with 401/403     | Missing `--token-env WEBFLOW_ADMIN_TOKEN`, or that token lacks Sites: Read and write. Don't add write scopes to the runtime token. |
| Deleted item still listed                  | Webflow keeps it in live lists until the next site publish: publish the site.                                                      |
| Route handler returns 500 on Webflow Cloud | A `runtime` export: remove it.                                                                                                     |
| Rich Text code block renders empty         | Webflow returns `<pre></pre>`: use an HTML embed or a separate field.                                                              |
| Warning to rerun typegen                   | A collection changed after typegen; data still works. Rerun typegen.                                                               |

## Before you finish

- `npx next-webflow typegen --check` passes (or typegen was just run).
- Type check and build pass (`next build`).
- No token values in source, no `runtime` export in Webflow routes, no `dangerouslySetInnerHTML` on Webflow fields.
- Tell the user which manual steps remain (env vars on the host, registering webhooks).
