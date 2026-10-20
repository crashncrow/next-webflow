import type { CacheAdapter } from "../src/core";

interface Entry {
  status: number;
  body: string;
  tags: string[];
}

/**
 * Minimal stand-in for the Next.js data cache: `force-cache` responses are stored per URL with
 * their `next.tags`, and `revalidateTag` evicts every entry carrying one of the given tags.
 */
export function createFakeNextCache(options: { draft?: boolean } = {}) {
  const entries = new Map<string, Entry>();
  const requests: Array<{ url: string; init: RequestInit & { next?: { tags?: string[] } } }> = [];
  let draft = options.draft ?? false;

  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const nextInit = init as RequestInit & { next?: { tags?: string[] } };
    const cacheable = !draft && nextInit.cache === "force-cache";
    const hit = cacheable ? entries.get(url) : undefined;
    if (hit) return new Response(hit.body, { status: hit.status });

    requests.push({ url, init: nextInit });
    const response = await globalThis.fetch(input, init);
    const body = await response.text();
    if (cacheable && response.ok) entries.set(url, { status: response.status, body, tags: nextInit.next?.tags ?? [] });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  const adapter: CacheAdapter = {
    init: (tags) => ({ cache: "force-cache", next: { tags } }),
    isDraft: async () => draft,
  };

  return {
    fetch,
    adapter,
    requests,
    revalidateTag(...tags: string[]) {
      for (const [url, entry] of entries) {
        if (entry.tags.some((tag) => tags.includes(tag))) entries.delete(url);
      }
    },
    setDraft(value: boolean) {
      draft = value;
    },
  };
}
