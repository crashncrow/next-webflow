![Webflow + Next.js](examples/blog/public/webflow-next-banner.webp)

**Webflow CMS for Next.js.**

Typed content, signed draft previews, and webhook-driven cache revalidation. Let editors manage content in Webflow while you build the experience in React.

[![CI](https://github.com/crashncrow/next-webflow/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/crashncrow/next-webflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Guide](packages/next-webflow/README.md) · [Live demo](https://nextjswebflow.vercel.app/) · [Example app](examples/blog) · [Docs](docs) · [Try the beta](#try-the-beta)

> **Beta:** `0.1.0-beta.1`, published on npm under the `beta` tag. APIs may still change before `0.1.0`.

## Your CMS, a typed client

```tsx
// app/page.tsx
import Link from "next/link";
import { getItems } from "@/webflow";

export default async function Blog() {
  const posts = await getItems("posts", { limit: 10 });

  return (
    <main>
      {posts.map((post) => (
        <Link key={post.id} href={`/posts/${post.fieldData.slug}`}>
          {post.fieldData.name}
        </Link>
      ))}
    </main>
  );
}
```

`@/webflow` is the client `next-webflow typegen` generates from your site.

## Why next-webflow?

Every team that puts Webflow content on a Next.js site writes the same glue: a fetch wrapper, hand-written types that drift from the CMS, a cache that's either stale or skipped, a webhook route, a preview workaround. next-webflow is that glue, built once, tested against the real Webflow API, and gentle on its rate limits.

- **Catch CMS changes before your visitors do.** Types come from your actual collections and fields, Option fields arrive with their names, and references resolve into full items. Run `next-webflow typegen --check` in CI, and a field renamed in Webflow fails your build instead of breaking a page in production.
- **Publish in Webflow, live on the next request.** Reads are cached by Next.js with tags per site, collection, and item. A signed webhook invalidates exactly what changed: no full rebuilds, no waiting for a cache to expire.
- **Previews your editors can actually use.** Signed, expiring links open staged content inside your app, with a draft banner and an exit control.
- **Safe Rich Text by default.** The Data API returns Rich Text HTML exactly as stored, scripts included. `WebflowRichText` sanitizes it, turns internal links into `next/link`, and lets you swap any element for your own components.

### When to use it

**A good fit** if editors manage content in Webflow and developers build the site in Next.js (App Router): blogs, editorial and marketing sites, company websites, resource libraries, documentation, and content catalogs.

**Look elsewhere** if your site is built and hosted entirely in Webflow's Designer, or if you use the Pages Router or another framework. To write to the CMS or manage sites, use Webflow's official SDK, [`webflow-api`](https://github.com/webflow/js-webflow-api): it covers the whole Data API, while next-webflow only reads CMS content for Next.js (with its own client, not the SDK). The two work well together, for example the SDK in a script that creates content and next-webflow to display it.

## Try the beta

Requirements for your app: **Next.js 15 or 16 with the App Router, React 19, and Node.js 22.12+**.

```bash
npm install next-webflow@beta
```

The beta is published under the `beta` tag, so a plain `npm install next-webflow` won't install it until `0.1.0` is out.

Continue with the [guide](packages/next-webflow/README.md#quick-start) from step 2 (credentials, typegen, reading content, webhooks), or start from the [example blog](examples/blog). The [live demo](https://nextjswebflow.vercel.app) runs on Vercel with real Webflow content. Webflow Cloud support is a **preview**: see the [Webflow Cloud guide](docs/webflow-cloud.md).

## Contributing

Bugs and ideas: [issues](https://github.com/crashncrow/next-webflow/issues). Setup, commands and the rules for code changes: [CONTRIBUTING.md](CONTRIBUTING.md). Security problems: report them privately, see [SECURITY.md](SECURITY.md).

## License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Made with 🧉 by <a href="https://nnaro.dev">nnaro.dev</a></sub>
</p>
