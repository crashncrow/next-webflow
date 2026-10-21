// Spike only (stage 5b): a `fetch` for createWebflow({ fetch }) that records every Webflow request
// (path, status, time, size, rate limit, CDN cache).
export interface RequestRecord {
  path: string;
  status: number;
  ms: number;
  bytes: number;
  rateLimitRemaining: string | null;
  cdnCache: string | null;
}

export function createMeasuredFetch({ log }: { log?: (record: RequestRecord) => void } = {}) {
  const records: RequestRecord[] = [];
  const measuredFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const started = Date.now();
    const response = await fetch(url, init);
    const bytes = (await response.clone().arrayBuffer()).byteLength;
    const record: RequestRecord = {
      path: `${url.host === "api-cdn.webflow.com" ? "cdn:" : ""}${url.pathname.replace("/v2", "")}${url.search}`,
      status: response.status,
      ms: Date.now() - started,
      bytes,
      rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
      cdnCache: response.headers.get("cf-cache-status"),
    };
    records.push(record);
    log?.(record);
    return response;
  };
  return { fetch: measuredFetch, records };
}
