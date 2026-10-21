import Link from "next/link";
import { createWebflowClient, createWebflowCms, noCache, type WebflowListResponse } from "next-webflow";

export const dynamic = "force-dynamic";

const LEVELS = [2, 4, 6, 8, 12];

/**
 * `pageSize=100` (default): the library's real `getItems` (needs > 600 items for > 6 pages).
 * `pageSize < 100`: same parallel pagination through the client's limiter, with small pages, so
 * a handful of items already produces more than 6 concurrent pages (works on any site plan).
 */
export default async function PaginationPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; collection?: string; pageSize?: string }>;
}) {
  const params = await searchParams;
  const concurrency = Number(params.c ?? 4);
  const collection = params.collection ?? "posts";
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize ?? 100)));

  const started = Date.now();
  let outcome: string;
  try {
    if (pageSize === 100) {
      const cms = createWebflowCms({ concurrency, cache: noCache });
      const items = await cms.getItems(collection);
      outcome = `OK: ${items.length} items in ${Date.now() - started} ms`;
    } else {
      const client = createWebflowClient({ concurrency });
      const { collections } = await client.request<{ collections: Array<{ id: string; slug: string }> }>(
        `/sites/${process.env.WEBFLOW_SITE_ID}/collections`,
      );
      const id = collections.find((candidate) => candidate.slug === collection)?.id;
      if (!id) throw new Error(`Collection "${collection}" not found`);
      const first = await client.request<WebflowListResponse<unknown>>(`/collections/${id}/items/live`, {
        query: { limit: pageSize, offset: 0 },
      });
      const offsets: number[] = [];
      for (let offset = pageSize; offset < first.pagination.total; offset += pageSize) offsets.push(offset);
      const pages = await Promise.all(
        offsets.map((offset) =>
          client.request<WebflowListResponse<unknown>>(`/collections/${id}/items/live`, {
            query: { limit: pageSize, offset },
          }),
        ),
      );
      const count = first.items.length + pages.reduce((sum, page) => sum + page.items.length, 0);
      outcome = `OK: ${count} items in ${offsets.length + 1} pages (${offsets.length} in parallel) in ${Date.now() - started} ms`;
    }
  } catch (error) {
    outcome = `FAILED after ${Date.now() - started} ms: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
  }

  return (
    <main>
      <h1>
        Pagination (concurrency {concurrency}, page size {pageSize})
      </h1>
      <p>
        Collection <code>{collection}</code>, no cache. Includes schema/collection lookup requests.
      </p>
      <p>
        <strong>{outcome}</strong>
      </p>
      <p>
        Small pages:{" "}
        {LEVELS.map((level) => (
          <span key={level}>
            <Link href={`/pagination?c=${level}&pageSize=1&collection=${collection}`}>c={level}</Link>{" "}
          </span>
        ))}
      </p>
      <p>
        Real getItems (100 per page):{" "}
        {LEVELS.map((level) => (
          <span key={level}>
            <Link href={`/pagination?c=${level}&collection=${collection}`}>c={level}</Link>{" "}
          </span>
        ))}
      </p>
    </main>
  );
}
