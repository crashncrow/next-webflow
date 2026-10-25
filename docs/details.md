# next-webflow: details and measurements

How next-webflow works under the hood, and the numbers behind its defaults. You don't need any of this to use the library; the [package README](../packages/next-webflow/README.md) covers usage.

## References (`include`)

- **Whole collection or by ID.** If the referenced collection has at most `maxIncludeItems` items (default 1,000), next-webflow reads the whole collection once, cached under its collection tag, and joins in memory. Above that, it reads only the referenced items, by ID, each cached under its item tag. Either way the page keeps the tags it needs, so republishing a referenced item refreshes it.
- **Cost** (cold cache, **extrapolated** from a 35-item test collection, ~2.4 KB per item; not measured on 100-item pages yet): ≈ 0.3–0.6 s and 1 request per 100 items of the referenced collection, 4 pages in parallel. At the 1,000-item default that's ≤ 10 requests and ~1–2 s, once; afterwards it's a cache hit.

## Builds (`generateStaticParams`)

- During `next build`, every page reads the collection's cached list (the same pages `getItems` fetches) and finds its slug there. A build costs about one request per 100 items instead of one per page, and every page still carries the collection tag for webhooks. Measured on 35 pages: 1 API request for the list instead of 36.
- Above `maxBuildListItems` (default 5,000) it warns, because every page reads the whole cached list. Estimated parsing cost: ~7 ms per page at 5,000 items (~3 s across 10 build workers), ~26 ms at 20,000 (~1 min). Lookups keep using the list.
- Next.js doesn't cache responses over 2 MB. next-webflow warns if a list page is that big (items averaging over ~20 KB, e.g. very long rich text).

## Option names

Renaming an option in Webflow keeps its ID, so a generated schema can't tell it changed, and Webflow sends no webhook when a collection's structure changes. With `optionNames: "live"` (the default), next-webflow normalizes items with the generated schema but takes Option names from the collection's live schema (`GET /collections/{id}`):

- Cached like content, with the site and collection tags: a rename shows once the collection is invalidated, at the latest on the next site publish.
- One cached request to the Data API (also with `source: "cdn"`) per collection whose items have Option values; none if they don't. In draft mode it isn't cached, like the rest of the preview.
- It isn't kept in memory between requests, so a `site_publish` invalidation is seen right away.
- A rename logs a one-time warning to rerun typegen. Options added after typegen go through the stale-schema fallback. If the schema can't be read, the generated names are used.

## Rich Text sanitizing

The Data API returns Rich Text HTML exactly as it was stored. `WebflowRichText` sanitizes the parsed tree before React renders it. It removes:

- `<script>`, `<object>`, `<embed>`, `<applet>`, `<base>`, `<meta>`;
- every `on*` attribute and `srcdoc`;
- `javascript:`, `vbscript:` and `data:` URLs in `href`, `src`, `action`, `formaction`, `xlink:href`, `data`, `poster`, `background`, `cite`, `ping`, `longdesc`, `manifest`, `codebase`, `srcset` and SVG animation attributes (`values`, `to`, `from`, `by`), after stripping whitespace and control characters;
- `style` values with `javascript:`, `expression(` or `url(data:`.

Iframes with normal URLs (YouTube, Vimeo) and code embeds without scripts still render. React 19 also blocks `javascript:` links even with `allowScripts`.

## Rich Text layout

- **Videos and embedded posts** (YouTube, Vimeo, tweets: Webflow stores them all as video figures). Webflow sizes them with an inline `padding-bottom` that relies on its own CSS. next-webflow replaces it with `aspect-ratio` from the figure's `data-rt-dimensions` and sizes the iframe to fill it. Webflow's classes (`w-richtext-figure-type-video`, `w-richtext-align-center`…) stay on the elements, and a `figure` override in `components` receives them (`className`, adjusted `style`). Embedded posts keep the ratio Webflow stores (a tweet is 500:281); the original URL is in `data-page-url`.
- **Images** get `max-width:100%; height:auto`, and Webflow's `width="auto"` attributes are dropped, so large uploads don't overflow without Webflow's CSS.
- **Inherited alt text.** When an editor doesn't set alt text on an image, Webflow stores the placeholder `__wf_reserved_inherit` ("use the asset's alt text"). It's never rendered: Rich Text images and `WebflowImage` get `alt=""`, Image fields get `alt: null`, and development builds warn.
- **Tailwind:** the README's typography setup was checked with Tailwind 4.3 and `@tailwindcss/typography` 0.5.20 on a real post (headings, lists, captions, quotes, videos).

## Images

Webflow's CDN doesn't resize images. We verified that `width`, `w`, `q` and `format` parameters are ignored, that CMS images have no `-p-500` variants, and that there's no `/cdn-cgi/image/`. So next-webflow has no custom loader; on Vercel or `next start`, Next.js' optimizer resizes and re-encodes them. On Webflow Cloud they're served at their original size ([details](webflow-cloud.md#images)).

## Errors and retries

Every error is a subclass of `WebflowError`, exported from `next-webflow`:

| Error                                                | When                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `WebflowConfigError`                                 | No token, unknown collection                                                       |
| `WebflowUnauthorizedError` / `WebflowForbiddenError` | Token or scopes                                                                    |
| `WebflowNotFoundError`                               | A collection that doesn't exist (missing items return `null` instead)              |
| `WebflowRateLimitError`                              | After retries, or when `Retry-After` exceeds `maxRetryAfterMs`; has `retryAfterMs` |
| `WebflowServerError` / `WebflowNetworkError`         | Webflow failed, or the request didn't get through, after retries                   |

429 responses are retried honoring `Retry-After`; 5xx and network errors are retried for reads only, so creating a webhook is never duplicated.

## Known Webflow behavior

- **Deleted items linger in live lists.** After you delete a published item, Webflow's `/items/live` list (and `?slug=` lookups) keeps returning it until the next site publish, even though the item itself returns 404 (measured on 2026-10-21: still listed after 10 minutes). next-webflow invalidates on the delete webhook, but the refetch gets the same stale list. Publishing the site fires `site_publish`, which invalidates everything.
- **Collections never published** answer 404 on their live items, and on a **site never published** every live read answers 409 (`Conflict with server data: The site is not published.`). next-webflow treats both as empty (`[]`, `null`); a missing collection still throws, and draft (staged) reads aren't affected. Pages rendered this way keep the collection's tags, so the first site publish refreshes them.
- **Rate limits:** Webflow's docs say 60 requests per minute on Starter and Basic plans and 120 on CMS, eCommerce and Business; our Starter test site reported 150, so next-webflow never hard-codes a limit.
