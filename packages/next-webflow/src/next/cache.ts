// `.js` extension: `next` has no `exports` map, so the bare subpath fails in plain Node ESM
// (CLI, scripts). Bundlers resolve both forms.
import { draftMode } from "next/headers.js";
import type { CacheAdapter } from "../core/cms";

/**
 * Next.js data cache via `fetch` (`force-cache` + `next.tags`), not `use cache`
 * (unsupported on Webflow Cloud). Draft mode bypasses the cache.
 */
export const nextCache: CacheAdapter = {
  init: (tags) => ({ cache: "force-cache", next: { tags } }),
  async isDraft() {
    try {
      // Reading `isEnabled` doesn't opt the route into dynamic rendering.
      return (await draftMode()).isEnabled;
    } catch {
      // Outside a request (generateStaticParams, scripts): never draft.
      return false;
    }
  },
};
