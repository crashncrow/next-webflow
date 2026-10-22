import { createHmac } from "node:crypto";

export const NOW = 1_792_553_132_801;
export const SECRET = "whsec_test_secret_one";
export const ENDPOINT = "https://example.com/api/webflow";

/** Independent reference implementation (node:crypto) of Webflow's signature. */
export function sign(rawBody: string, timestamp: number | string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex");
}

/** A webhook request as Webflow sends it. `body` objects are serialized once; that string is signed. */
export function webhookRequest(
  body: unknown,
  {
    secret = SECRET,
    timestamp = NOW,
    signed = true,
    headers = {},
  }: {
    secret?: string;
    timestamp?: number;
    signed?: boolean;
    headers?: Record<string, string>;
  } = {},
): Request {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const signature = signed
    ? { "x-webflow-timestamp": String(timestamp), "x-webflow-signature": sign(rawBody, timestamp, secret) }
    : {};
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", ...signature, ...headers },
    body: rawBody,
  });
}
