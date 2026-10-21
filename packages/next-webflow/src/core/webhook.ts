import { SITE_TAG, collectionTag, itemTag, validTags } from "./tags";

/** Webflow rejects nothing older than this itself; we refuse older (or future) timestamps to stop replays. */
export const DEFAULT_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export const SIGNATURE_HEADER = "x-webflow-signature";
export const TIMESTAMP_HEADER = "x-webflow-timestamp";

/** `WEBFLOW_WEBHOOK_SECRET` holds one secret per registered webhook, comma-separated. */
export function parseSecrets(value: string | readonly string[] | undefined): string[] {
  const list = typeof value === "string" ? value.split(",") : (value ?? []);
  return [...new Set(list.map((secret) => secret.trim()).filter(Boolean))];
}

export type SignatureFailure =
  /** Neither signature header is present: a dashboard-created (unsigned) webhook, or not Webflow. */
  | "unsigned"
  /** Only one header, a non-numeric timestamp, or a signature that isn't 64 hex characters. */
  | "malformed"
  /** Timestamp outside the tolerance window (replay protection). */
  | "expired"
  /** No configured secret produced this signature. */
  | "invalid";

export type SignatureResult = { ok: true; secretIndex: number } | { ok: false; reason: SignatureFailure };

export interface VerifySignatureInput {
  /** The request body exactly as received (never re-serialized JSON). */
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  secrets: readonly string[];
  /** Milliseconds since epoch; injectable for tests. */
  now?: number;
  toleranceMs?: number;
}

/**
 * Verifies `x-webflow-signature`: hex HMAC-SHA256 of `${timestamp}:${rawBody}` (timestamp in ms),
 * trying each secret in turn. Uses only `crypto.subtle` and a constant-time comparison.
 */
export async function verifyWebflowSignature(input: VerifySignatureInput): Promise<SignatureResult> {
  const { rawBody, signature, timestamp, secrets } = input;
  if (!signature && !timestamp) return { ok: false, reason: "unsigned" };
  if (!signature || !timestamp || !/^\d+$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) {
    return { ok: false, reason: "malformed" };
  }

  const now = input.now ?? Date.now();
  if (Math.abs(now - Number(timestamp)) > (input.toleranceMs ?? DEFAULT_TIMESTAMP_TOLERANCE_MS)) {
    return { ok: false, reason: "expired" };
  }

  const expected = hexToBytes(signature.toLowerCase());
  const message = new TextEncoder().encode(`${timestamp}:${rawBody}`);
  for (const [index, secret] of secrets.entries()) {
    const actual = await hmacSha256(secret, message);
    if (constantTimeEqual(actual, expected)) return { ok: true, secretIndex: index };
  }
  return { ok: false, reason: "invalid" };
}

async function hmacSha256(secret: string, message: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Compares every byte regardless of where the first difference is (no early exit). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

/** Webhook events next-webflow handles. Others are accepted and ignored. */
export const CMS_WEBHOOK_EVENTS = [
  "collection_item_created",
  "collection_item_changed",
  "collection_item_deleted",
  "collection_item_unpublished",
  "collection_item_published",
  "site_publish",
] as const;

export type CmsWebhookEvent = (typeof CMS_WEBHOOK_EVENTS)[number];

/**
 * What `webhooks register` subscribes to by default: every event that can change live content.
 * `created`/`changed` are included because API writes to live items (`/items/live`) fire only them.
 */
export const DEFAULT_WEBHOOK_EVENTS: readonly CmsWebhookEvent[] = CMS_WEBHOOK_EVENTS;

/** Events fired for staged edits and for API writes to live items alike; told apart by `isDraft`. */
const EDIT_EVENTS = new Set<string>(["collection_item_created", "collection_item_changed"]);
const LIVE_ITEM_EVENTS = new Set<string>([
  "collection_item_published",
  "collection_item_unpublished",
  "collection_item_deleted",
]);

/** One CMS item from a webhook payload. */
export interface WebhookItem {
  id: string;
  collectionId: string | undefined;
  /** `fieldData.slug` when not localized. */
  slug: string | undefined;
  /** Docs show both `isArchived` and `archived`; whichever is present. */
  isArchived: boolean | undefined;
  /**
   * Docs show both `isDraft` and `draft`; whichever is present. `true` while the item has staged
   * (unpublished) changes; `false` after it's published or written through `/items/live`.
   */
  isDraft: boolean | undefined;
  /** Debug info only: undocumented relation to `isDraft`, never used to decide invalidation. */
  lastPublished: string | null | undefined;
  lastUpdated: string | null | undefined;
}

export interface WebflowWebhookEvent {
  triggerType: string;
  /** CMS items in the payload (`collection_item_published` may carry several). Empty for other events. */
  items: WebhookItem[];
  /** The parsed body, untouched. */
  raw: unknown;
}

/** Parses a webhook body (`{ triggerType, payload }`). Returns `undefined` if it doesn't look like one. */
export function parseWebhookEvent(body: unknown): WebflowWebhookEvent | undefined {
  if (!isRecord(body) || typeof body.triggerType !== "string") return undefined;
  const payload = isRecord(body.payload) ? body.payload : {};
  const isItemEvent = EDIT_EVENTS.has(body.triggerType) || LIVE_ITEM_EVENTS.has(body.triggerType);
  // `collection_item_published` wraps items in `items` (verified); current docs show a flat item,
  // which every other item event uses. Accept both.
  const candidates: unknown[] = !isItemEvent ? [] : Array.isArray(payload.items) ? payload.items : [payload];
  const items = candidates.flatMap((candidate) => {
    const item = parseItem(candidate);
    return item ? [item] : [];
  });
  return { triggerType: body.triggerType, items, raw: body };
}

function parseItem(value: unknown): WebhookItem | undefined {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  const fieldData = isRecord(value.fieldData) ? value.fieldData : {};
  return {
    id: value.id,
    collectionId: typeof value.collectionId === "string" ? value.collectionId : undefined,
    slug: typeof fieldData.slug === "string" ? fieldData.slug : undefined,
    isArchived: booleanField(value, "isArchived", "archived"),
    isDraft: booleanField(value, "isDraft", "draft"),
    lastPublished: dateField(value.lastPublished),
    lastUpdated: dateField(value.lastUpdated),
  };
}

function dateField(value: unknown): string | null | undefined {
  return typeof value === "string" || value === null ? value : undefined;
}

function booleanField(value: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) if (typeof value[key] === "boolean") return value[key];
  return undefined;
}

export interface EventTagsOptions {
  /**
   * Also invalidate on `collection_item_created` / `collection_item_changed` for items with
   * `isDraft: true` (staged edits, which don't change live content). Off by default.
   */
  invalidateOnStagedChanges?: boolean;
}

/**
 * Cache tags to invalidate for a webhook event:
 * - `collection_item_published` / `_unpublished` / `_deleted`: each item's item tag and its
 *   collection tag (slug lookups carry the collection tag, so renamed slugs are covered).
 * - `site_publish`: the site tag (everything).
 * - `collection_item_created` / `_changed`: the same tags, except for items with `isDraft: true`
 *   (staged edits) unless `invalidateOnStagedChanges`. Fail-safe: a missing `isDraft` invalidates,
 *   so a wrong guess over-invalidates instead of serving stale content. API writes to live items
 *   fire only these events (with `isDraft: false`).
 */
export function tagsForEvent(event: unknown, options: EventTagsOptions = {}): string[] {
  const parsed = isWebhookEvent(event) ? event : parseWebhookEvent(event);
  if (!parsed) return [];
  if (parsed.triggerType === "site_publish") return [SITE_TAG];

  let items: WebhookItem[];
  if (LIVE_ITEM_EVENTS.has(parsed.triggerType)) items = parsed.items;
  else if (EDIT_EVENTS.has(parsed.triggerType)) {
    items = options.invalidateOnStagedChanges ? parsed.items : parsed.items.filter((item) => item.isDraft !== true);
  } else return [];

  return validTags(
    items.flatMap((item) => [
      ...(item.collectionId ? [collectionTag(item.collectionId)] : []),
      itemTag(item.id),
    ]),
  );
}

function isWebhookEvent(value: unknown): value is WebflowWebhookEvent {
  return isRecord(value) && typeof value.triggerType === "string" && Array.isArray(value.items) && "raw" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
