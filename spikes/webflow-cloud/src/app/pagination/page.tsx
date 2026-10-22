import Link from "next/link";
import { createWebflowCms } from "next-webflow";
import { readRawPages } from "@/lib/raw-pages";
import { schema } from "@/webflow/schema";

export const dynamic = "force-dynamic";

const LEVELS = [2, 4, 6, 8, 12];

/**
 * `pageSize=100` (default): the library's real `getItems` (needs > 600 items for > 6 pages).
 * `pageSize < 100`: the same parallel pagination with small pages (`readRawPages`), so a handful
 * of items already produces more than 6 concurrent pages (works on any site plan).
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
      // No `cache`: createWebflowCms reads uncached (and never draft) by default.
      const cms = createWebflowCms({ concurrency });
      const items = await cms.getItems(collection);
      outcome = `OK: ${items.length} items in ${Date.now() - started} ms`;
    } else {
      const id = (schema as Record<string, { id: string } | undefined>)[collection]?.id;
      if (!id) throw new Error(`Collection "${collection}" isn't in src/webflow/schema.ts (rerun typegen)`);
      const { items, pages } = await readRawPages({ collectionId: id, pageSize, concurrency });
      outcome = `OK: ${items} items in ${pages} pages (${pages - 1} in parallel) in ${Date.now() - started} ms`;
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
        Collection <code>{collection}</code>, no cache. The real <code>getItems</code> runs without a generated schema,
        so its time includes the schema lookups.
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
