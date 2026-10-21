/** Cache tag for the whole site. Invalidated by `site_publish`. */
export const SITE_TAG = "webflow";

/** Next.js ignores tags longer than this. */
export const MAX_TAG_LENGTH = 256;

export const collectionTag = (collectionId: string): string => `webflow:collection:${collectionId}`;

export const itemTag = (itemId: string): string => `webflow:item:${itemId}`;

export const slugTag = (collectionId: string, slug: string): string =>
  `webflow:collection:${collectionId}:slug:${slug}`;

/** Drops tags Next.js would ignore anyway, and duplicates. */
export function validTags(tags: readonly string[]): string[] {
  return [...new Set(tags.filter((tag) => tag.length <= MAX_TAG_LENGTH))];
}

export type SlugStrategy = "collection";

/**
 * Tags for a slug lookup. Slug lookups also carry the collection tag, so renaming an
 * item's slug (the webhook only carries the new one) invalidates the old slug's page.
 * Cost: any change in the collection invalidates every cached slug lookup in it.
 * A precise two-step strategy may be added later as an opt-in.
 */
export function slugLookupTags(collectionId: string, slug: string, _strategy: SlugStrategy = "collection"): string[] {
  return validTags([SITE_TAG, collectionTag(collectionId), slugTag(collectionId, slug)]);
}

export function listTags(collectionId: string): string[] {
  return [SITE_TAG, collectionTag(collectionId)];
}

export function itemTags(itemId: string): string[] {
  return [SITE_TAG, itemTag(itemId)];
}

/** Tags for a collection schema fetched from the API (fallback when no generated schema). */
export function schemaTags(collectionId?: string): string[] {
  return collectionId ? [SITE_TAG, collectionTag(collectionId)] : [SITE_TAG];
}
