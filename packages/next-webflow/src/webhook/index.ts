// `.js` extension: `next` has no `exports` map (see src/next/cache.ts).
import { revalidateTag } from "next/cache.js";
import {
  createWebhookRequestHandler,
  type RevalidateProfile,
  type WebhookHandlerOptions,
} from "../core/webhook-handler";

/**
 * Webhook endpoint for Next.js route handlers. Verifies the signature, invalidates the matching
 * cache tags with `revalidateTag(tag, profile)` and answers 200.
 *
 * ```ts
 * // app/api/webflow/route.ts (don't export `runtime`: "edge" returns 500 on Webflow Cloud)
 * import { createWebhookHandler } from "next-webflow/webhook";
 * export const POST = createWebhookHandler({ onEvent: (event) => console.log(event.triggerType) });
 * ```
 */
export function createWebhookHandler(options: WebhookHandlerOptions = {}): (request: Request) => Promise<Response> {
  return createWebhookRequestHandler(options, {
    // Next 16 requires the profile; Next 15 ignores the second argument.
    revalidate: (tag: string, profile: RevalidateProfile) => revalidateTag(tag, profile),
  });
}

/** Default endpoint: `export { POST } from "next-webflow/webhook";` */
export const POST = createWebhookHandler();

export { UNSIGNED_WEBHOOK_MESSAGE } from "../core/webhook-handler";
export type { RevalidateProfile, WebhookHandlerOptions, WebhookLogger } from "../core/webhook-handler";
export {
  DEFAULT_WEBHOOK_EVENTS,
  parseWebhookEvent,
  tagsForEvent,
  verifyWebflowSignature,
  type EventTagsOptions,
  type WebflowWebhookEvent,
  type WebhookItem,
} from "../core/webhook";
