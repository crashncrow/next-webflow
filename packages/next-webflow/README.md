# next-webflow

Use the Webflow CMS as a headless content source in Next.js (App Router): generated types, caching, on-demand revalidation via webhooks, draft previews, and rendering components.

> **Work in progress.** Not published yet. The full README (setup, API, deployment) comes with v0.1.

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

## Webflow Cloud notes (preview)

Measured on Webflow Cloud on 2026-10-21 (Next.js 16.4, `@opennextjs/cloudflare` 1.20):

- **Don't add `export const runtime = "edge"` to route handlers.** Webflow's docs say API routes need the edge runtime, but in our tests every edge route returned `500 Internal Server Error`, while the same handlers on the default Node.js runtime worked. next-webflow's route handlers (webhook, draft) don't export `runtime`.
- **Keep secrets out of `.env*` files when deploying.** `webflow apps deploy` builds on your machine, and the build bakes every `.env*` file into the worker bundle in plain text. Upload variables with `webflow apps env-vars import <file> --secret` instead.
