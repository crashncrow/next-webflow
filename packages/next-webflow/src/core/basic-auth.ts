// HTTP Basic auth for internal pages (e.g. the drafts list), edge-compatible: crypto.subtle digests
// compared in constant time. Fails closed: no configured password → nobody gets in.
import { constantTimeEqual } from "./crypto";

export interface BasicAuthOptions {
  /** Required. `undefined` or empty (e.g. an unset env var) denies everyone with 503. */
  password: string | undefined;
  /** Optional; any username is accepted when omitted. */
  username?: string | undefined;
  /** Shown by the browser's login prompt. Default `"Restricted"`. */
  realm?: string | undefined;
}

const digest = async (value: string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

/** Equal-length digests, so neither the length nor the first difference leaks through timing. */
const sameSecret = async (a: string, b: string) => constantTimeEqual(await digest(a), await digest(b));

function decodeCredentials(header: string | null): { username: string; password: string } | undefined {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header ?? "");
  if (!match?.[1]) return undefined;
  try {
    const bytes = Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const separator = decoded.indexOf(":");
    if (separator < 0) return undefined;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return undefined;
  }
}

/**
 * `undefined` when the request carries the right credentials; otherwise the response to send:
 * 401 with a login prompt, or 503 when no password is configured.
 * Accepts a `Request` (proxy / middleware / route handler) or `Headers` (`await headers()` in a page).
 */
export async function requireBasicAuth(
  input: Request | Headers,
  options: BasicAuthOptions,
): Promise<Response | undefined> {
  const noStore = { "cache-control": "private, no-store" };
  if (!options.password) {
    return new Response("This page is disabled: no password is configured.", { status: 503, headers: noStore });
  }
  const headers = input instanceof Headers ? input : input.headers;
  const credentials = decodeCredentials(headers.get("authorization"));
  const passwordOk = await sameSecret(credentials?.password ?? "", options.password);
  const usernameOk =
    options.username === undefined || (await sameSecret(credentials?.username ?? "", options.username));
  if (credentials && passwordOk && usernameOk) return undefined;
  const realm = (options.realm ?? "Restricted").replace(/["\\]/g, "");
  return new Response("Authentication required.", {
    status: 401,
    headers: { ...noStore, "www-authenticate": `Basic realm="${realm}", charset="UTF-8"` },
  });
}
