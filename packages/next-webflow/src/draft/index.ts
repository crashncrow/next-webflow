// `.js` extension: `next` has no `exports` map (see src/next/cache.ts).
import { draftMode } from "next/headers.js";
import {
  createDraftRequestHandler,
  type DraftHandlerOptions,
  type DraftRouteHandlers,
} from "../core/draft-handler";
import type { WebflowSchema } from "../core/schema";

/**
 * The app's base path, which route handlers don't see on Webflow Cloud (`request.url` and
 * `nextUrl.basePath` lack the mount path). In order:
 * 1. `NEXT_PUBLIC_BASE_PATH`, the variable Webflow's "Bring your own app" docs tell users to set
 *    to the mount path (`""` counts: a root mount).
 * 2. `__NEXT_ROUTER_BASEPATH`, which Next.js inlines at build time. A Next.js **internal**: it may
 *    disappear in any release (`test/next/base-path-internal.test.ts` fails loudly if it does).
 * Both must stay literal `process.env.X` member expressions so Next.js can inline them.
 */
export function nextBasePath(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const documented = process.env.NEXT_PUBLIC_BASE_PATH;
  if (documented !== undefined) return documented;
  return process.env.__NEXT_ROUTER_BASEPATH || undefined;
}

/**
 * Draft mode route for Next.js: a signed preview link (see `createPreviewUrl`) enables draft
 * mode and redirects to the item's page; `?disable=1&path=/x` (GET) or `DELETE` leaves it.
 *
 * ```ts
 * // app/api/webflow/draft/route.ts (don't export `runtime`: "edge" returns 500 on Webflow Cloud)
 * import { createDraftHandler } from "next-webflow/draft";
 * import { schema } from "@/webflow/schema";
 * export const { GET, DELETE } = createDraftHandler({
 *   schema,
 *   resolvePath: (collection, item) => `/${collection}/${item.fieldData.slug}`,
 * });
 * ```
 */
export function createDraftHandler<const S extends WebflowSchema | undefined = undefined>(
  options: DraftHandlerOptions<S>,
): DraftRouteHandlers {
  return createDraftRequestHandler(options, {
    enable: async () => (await draftMode()).enable(),
    disable: async () => (await draftMode()).disable(),
    basePath: nextBasePath,
  });
}

export type { DraftHandlerOptions, DraftRouteHandlers } from "../core/draft-handler";
export { requireBasicAuth, type BasicAuthOptions } from "../core/basic-auth";
export {
  createPreviewUrl,
  safeRelativePath,
  DEFAULT_PREVIEW_EXPIRES_IN_SECONDS,
  DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS,
  type CreatePreviewUrlOptions,
} from "../core/preview";
