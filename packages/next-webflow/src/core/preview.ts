// Signed, expiring preview links for draft mode. The secret never travels in the URL: links carry
// `collection`, `item`, `expires` and an HMAC-SHA256 of them (crypto.subtle, constant-time compare).
import { ENV, readEnv } from "./env";
import { constantTimeEqual, hexToBytes, hmacSha256 } from "./crypto";
import { parseSecrets } from "./webhook";

/** Default lifetime of a preview link. */
export const DEFAULT_PREVIEW_EXPIRES_IN_SECONDS = 60 * 60;
/** Links whose `expires` is further away than this are rejected, whatever their signature. */
export const DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export const PREVIEW_PARAMS = { collection: "collection", item: "item", expires: "expires", signature: "sig" } as const;

export interface CreatePreviewUrlOptions {
  /** The draft route, absolute (`https://example.com/api/webflow/draft`) or relative (`/api/webflow/draft`). */
  url: string;
  /** Collection slug (`posts`). */
  collection: string;
  /** Item ID: survives slug changes while editors work. */
  itemId: string;
  /** Default `WEBFLOW_PREVIEW_SECRET` (the first one if comma-separated). */
  secret?: string | readonly string[] | undefined;
  /** Seconds until the link stops working. Default 1 hour. */
  expiresIn?: number | undefined;
  /** Milliseconds since epoch; injectable for tests. */
  now?: number | undefined;
}

const payload = (collection: string, itemId: string, expires: number) =>
  new TextEncoder().encode(`next-webflow-preview:v1:${collection}:${itemId}:${expires}`);

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** `secret`, or `WEBFLOW_PREVIEW_SECRET` (comma-separated). */
export function resolvePreviewSecrets(secret: string | readonly string[] | undefined): string[] {
  return parseSecrets(secret ?? readEnv(ENV.previewSecret));
}

/** Builds a signed preview link for one item. Server-side only (it needs the secret). */
export async function createPreviewUrl(options: CreatePreviewUrlOptions): Promise<string> {
  const [secret] = resolvePreviewSecrets(options.secret);
  if (!secret) throw new Error(`No preview secret: set ${ENV.previewSecret} or pass \`secret\`.`);
  const expiresIn = options.expiresIn ?? DEFAULT_PREVIEW_EXPIRES_IN_SECONDS;
  if (expiresIn > DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS) {
    throw new Error(
      `\`expiresIn\` must not exceed ${DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS} seconds (30 days). The handler can configure maxLifetimeSeconds, but createPreviewUrl enforces this maximum.`,
    );
  }
  if (!(expiresIn > 0)) throw new Error("`expiresIn` must be a positive number of seconds.");
  const expires = Math.floor((options.now ?? Date.now()) / 1000) + Math.round(expiresIn);
  const signature = toHex(await hmacSha256(secret, payload(options.collection, options.itemId, expires)));

  const relative = options.url.startsWith("/");
  const url = new URL(options.url, "https://relative.invalid");
  url.searchParams.set(PREVIEW_PARAMS.collection, options.collection);
  url.searchParams.set(PREVIEW_PARAMS.item, options.itemId);
  url.searchParams.set(PREVIEW_PARAMS.expires, String(expires));
  url.searchParams.set(PREVIEW_PARAMS.signature, signature);
  return relative ? `${url.pathname}${url.search}` : url.toString();
}

export type PreviewVerification =
  | { ok: true; collection: string; itemId: string; expires: number }
  | { ok: false; reason: "malformed" | "expired" | "invalid" };

export interface VerifyPreviewOptions {
  secrets: readonly string[];
  now?: number | undefined;
  maxLifetimeSeconds?: number | undefined;
}

/** Checks a preview link's query parameters. */
export async function verifyPreviewParams(
  params: URLSearchParams,
  options: VerifyPreviewOptions,
): Promise<PreviewVerification> {
  const collection = params.get(PREVIEW_PARAMS.collection);
  const itemId = params.get(PREVIEW_PARAMS.item);
  const expiresText = params.get(PREVIEW_PARAMS.expires);
  const signature = params.get(PREVIEW_PARAMS.signature);
  if (
    !collection ||
    !itemId ||
    !expiresText ||
    !/^\d{1,12}$/.test(expiresText) ||
    !signature ||
    !/^[0-9a-f]{64}$/i.test(signature)
  ) {
    return { ok: false, reason: "malformed" };
  }
  const expires = Number(expiresText);
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const maxLifetime = options.maxLifetimeSeconds ?? DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS;
  if (expires < now || expires > now + maxLifetime) return { ok: false, reason: "expired" };

  const expected = hexToBytes(signature.toLowerCase());
  for (const secret of options.secrets) {
    if (constantTimeEqual(await hmacSha256(secret, payload(collection, itemId, expires)), expected)) {
      return { ok: true, collection, itemId, expires };
    }
  }
  return { ok: false, reason: "invalid" };
}

/**
 * A same-site path to redirect to, or `undefined`: must start with `/`, not `//` or `/\`
 * (browsers read both as another host), and contain no scheme, backslashes or control characters.
 */
export function safeRelativePath(path: unknown): string | undefined {
  if (typeof path !== "string" || path.length === 0 || path.length > 2048) return undefined;
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return undefined;
  try {
    // Resolving against a dummy origin must not change the origin (catches odd encodings).
    const resolved = new URL(path, "https://same-site.invalid");
    if (
      resolved.origin !== "https://same-site.invalid" ||
      resolved.pathname.startsWith("//") ||
      resolved.pathname.startsWith("/\\")
    )
      return undefined;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return undefined;
  }
}
