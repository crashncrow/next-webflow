// `.js` extension: `next` has no `exports` map (see src/next/cache.ts).
import { draftMode } from "next/headers.js";
import {
  createDraftRequestHandler,
  type DraftHandlerOptions,
  type DraftRouteHandlers,
} from "../core/draft-handler";
import type { WebflowSchema } from "../core/schema";
import { nextBasePath } from "../next/base-path";


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

export { nextBasePath } from "../next/base-path";
export type { DraftHandlerOptions, DraftRouteHandlers } from "../core/draft-handler";
export { requireBasicAuth, type BasicAuthOptions } from "../core/basic-auth";
export {
  createPreviewUrl,
  safeRelativePath,
  DEFAULT_PREVIEW_EXPIRES_IN_SECONDS,
  DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS,
  type CreatePreviewUrlOptions,
} from "../core/preview";
