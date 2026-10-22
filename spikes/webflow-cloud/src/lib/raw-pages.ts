// Spike only (stages 3 and 5b): reads a collection in pages of `pageSize` items, every page after the
// first in parallel, at most `concurrency` in flight. Small pages simulate a large collection on a
// Starter site, to measure Webflow Cloud's limit of 6 concurrent outbound requests. Plain `fetch`
// on purpose: next-webflow's HTTP client isn't public, and the real `getItems` (100 per page) is
// measured through the library itself.
const HOSTS = { data: "https://api.webflow.com/v2", cdn: "https://api-cdn.webflow.com/v2" } as const;

interface ListResponse {
  items: unknown[];
  pagination: { total: number };
}

export interface RawPagesOptions {
  collectionId: string;
  pageSize: number;
  concurrency: number;
  host?: keyof typeof HOSTS;
  fetch?: typeof fetch;
}

export async function readRawPages(options: RawPagesOptions): Promise<{ items: number; pages: number }> {
  const token = process.env.WEBFLOW_CMS_TOKEN;
  if (!token) throw new Error("Set WEBFLOW_CMS_TOKEN");
  const fetchImpl = options.fetch ?? fetch;
  const base = `${HOSTS[options.host ?? "data"]}/collections/${options.collectionId}/items/live`;

  let active = 0;
  const waiting: Array<() => void> = [];
  const page = async (offset: number): Promise<ListResponse> => {
    if (active >= options.concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      const response = await fetchImpl(`${base}?limit=${options.pageSize}&offset=${offset}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} (offset ${offset})`);
      return (await response.json()) as ListResponse;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };

  const first = await page(0);
  const offsets: number[] = [];
  for (let offset = options.pageSize; offset < first.pagination.total; offset += options.pageSize) offsets.push(offset);
  const rest = await Promise.all(offsets.map(page));
  return {
    items: first.items.length + rest.reduce((sum, next) => sum + next.items.length, 0),
    pages: offsets.length + 1,
  };
}
