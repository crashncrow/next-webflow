/**
 * Cache probe: a raw `fetch` with `force-cache` + a tag. On a cache HIT the response is the
 * stored one, so its `date` and `x-ratelimit-remaining` headers stay frozen and it's fast.
 * `isolate` identifies the Worker isolate that served the request (in-memory vs shared cache).
 */
const globalState = globalThis as { __spikeIsolate?: string };
export const isolate = (globalState.__spikeIsolate ??= crypto.randomUUID().slice(0, 8));

export interface ProbeResult {
  tag: string;
  runtime: string;
  isolate: string;
  servedAt: string;
  /** `date` header of the (possibly cached) Webflow response: when Webflow was actually called. */
  fetchedAt: string | null;
  rateLimitRemaining: string | null;
  durationMs: number;
  status: number | null;
  error?: string;
}

export async function probe(tag: string, runtime: string): Promise<ProbeResult> {
  const started = Date.now();
  const base = { tag, runtime, isolate, servedAt: new Date().toISOString() };
  try {
    const response = await fetch(`https://api.webflow.com/v2/sites/${process.env.WEBFLOW_SITE_ID}`, {
      headers: { authorization: `Bearer ${process.env.WEBFLOW_API_TOKEN}`, accept: "application/json" },
      cache: "force-cache",
      next: { tags: [tag] },
    });
    await response.arrayBuffer();
    return {
      ...base,
      fetchedAt: response.headers.get("date"),
      rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
      durationMs: Date.now() - started,
      status: response.status,
    };
  } catch (error) {
    return {
      ...base,
      fetchedAt: null,
      rateLimitRemaining: null,
      durationMs: Date.now() - started,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function checkSecret(provided: unknown): boolean {
  const expected = process.env.SPIKE_SECRET;
  return typeof expected === "string" && expected.length > 0 && provided === expected;
}
