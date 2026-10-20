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

interface ItemPayload {
  id?: unknown;
  collectionId?: unknown;
  fieldData?: unknown;
}

const CMS_ITEM_EVENTS = new Set([
  "collection_item_created",
  "collection_item_changed",
  "collection_item_deleted",
  "collection_item_unpublished",
]);

/**
 * Maps a webhook body (`{ triggerType, payload }`) to the cache tags to invalidate.
 * `collection_item_published` carries an `items` array; every item is invalidated.
 * Unknown or malformed events map to no tags.
 */
export function tagsForEvent(event: { triggerType?: unknown; payload?: unknown }): string[] {
  const payload = isObject(event.payload) ? event.payload : {};

  if (event.triggerType === "site_publish") return [SITE_TAG];

  if (event.triggerType === "collection_item_published") {
    const items: unknown[] = Array.isArray(payload.items) ? payload.items : [];
    return validTags(items.flatMap((item) => (isObject(item) ? tagsForItem(item) : [])));
  }

  if (typeof event.triggerType === "string" && CMS_ITEM_EVENTS.has(event.triggerType)) {
    return validTags(tagsForItem(payload));
  }

  return [];
}

function tagsForItem(item: ItemPayload): string[] {
  const tags: string[] = [];
  const collectionId = typeof item.collectionId === "string" ? item.collectionId : undefined;
  if (collectionId) tags.push(collectionTag(collectionId));
  if (typeof item.id === "string") tags.push(itemTag(item.id));
  const slug = isObject(item.fieldData) ? item.fieldData.slug : undefined;
  if (collectionId && typeof slug === "string") tags.push(slugTag(collectionId, slug));
  return tags;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
