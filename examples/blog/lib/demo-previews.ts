// DEMO ONLY. With DEMO_PUBLIC_PREVIEWS=true, any visitor can preview a post's unpublished
// draft: the live demo's CMS holds only demonstration content. On a real site leave it unset and
// give editors preview links from the password-protected /drafts page instead.
import { SITE_TAG, collectionTag } from "next-webflow";
import { schema } from "@/webflow/schema";

export const publicPreviews = process.env.DEMO_PUBLIC_PREVIEWS === "true";

/**
 * Whether this item has unpublished changes (only checked when public previews are on).
 *
 * next-webflow never caches staged reads (drafts must not leak into cached pages), so this one
 * plain `fetch` does: it's a yes/no for a button, and caching it keeps post pages static. It
 * carries the same tags as published reads, and the webhook route invalidates on staged edits
 * when public previews are on.
 */
export async function hasDraft(itemId: string): Promise<boolean> {
  if (!publicPreviews) return false;
  const collectionId = schema.posts.id;
  const response = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items?limit=100`, {
    headers: { authorization: `Bearer ${process.env.WEBFLOW_CMS_TOKEN}` },
    cache: "force-cache",
    next: { tags: [SITE_TAG, collectionTag(collectionId)] },
  });
  if (!response.ok) return false; // no button rather than a broken page
  const { items } = (await response.json()) as { items: Array<{ id: string; isDraft: boolean }> };
  return items.some((item) => item.id === itemId && item.isDraft);
}
