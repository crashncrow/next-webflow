# next-webflow

## 0.1.0-beta.2

### Minor Changes

- 10089e5: First release: typed client generated from your Webflow site (`typegen`), cached reads with tags per site, collection and item, signed webhook handler and registration CLI, `include` for references, signed draft previews, and components (`WebflowRichText`, `WebflowImage`, `DraftModeBanner`).
- 646fda2: Removed internal helpers from the public entry points before the stable release: `UNSIGNED_WEBHOOK_MESSAGE` (`next-webflow/webhook`), and `safeRelativePath`, `DEFAULT_PREVIEW_EXPIRES_IN_SECONDS` and `DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS` (`next-webflow/draft`). The defaults stay documented (1 hour, 30 days). `ExitPreviewLink` (`next-webflow/components/client`) is now documented in the README for custom draft banners.
- 0297db3: `getItems` filters are typed from the generated schema: keys must be fields of the collection (camelCase or API slug), and Option fields take only the schema's option IDs with `eq`, `ne`, `in` and `nin`. A misspelled field or an option name (which Webflow answers with an empty list) now fails type checking instead of at request time. A plain `string`, such as a route param, has to be narrowed to the option IDs first. New types: `FilterOf`, `TypedGetItemsOptions` and `OptionIdOf`. Clients without a generated schema are unchanged.

### Patch Changes

- 16fcf55: Document the `next-webflow` agent skill for AI coding agents (`skills/next-webflow/SKILL.md` in the repository, installable with `npx skills add crashncrow/next-webflow`) in the README.
- cce09ed: README fixes: sorting by custom fields is a next-webflow limitation, not Webflow's (the Data API supports it); the Quick start explains the separate token for registering webhooks; rate limits no longer quote fixed numbers per plan; every `DraftModeBanner` prop is listed; examples use the same `/posts/` route throughout; the README is regrouped by task (Reading content, Keeping pages fresh, Draft previews, Rendering, Setup reference), with each handler's options next to its feature; Known limitations separates Webflow behavior from what next-webflow doesn't support; the drafts page setup says to name the proxy `middleware.ts` on Next.js 15.
- dde709d: Request URLs trim slashes with a loop instead of a regular expression that took quadratic time on long runs of `/` (reported by CodeQL). URLs, and therefore cache keys, are unchanged.
- 174e022: Live reads of a site that was never published (Webflow answers 409, "The site is not published.") return an empty list, or `null` for `getItemBySlug` and `getItem`, the same way a never-published collection's 404 already did, instead of throwing and failing the build.
