import { createWebflowClient, type WebflowListResponse } from "next-webflow";
import { createWebflow } from "next-webflow";
import { checkSecret } from "@/lib/probe";
import { createMeasuredFetch } from "@/lib/measured-fetch";
import { schema } from "@/webflow/schema";

// Spike only (stage 5b). Call right after revalidating the collection tag (cold cache).
// mode=library: the real getItems (100 per page). mode=pages: raw list requests of `pageSize`
// items, all pages in parallel through the client's limiter (simulates many pages on a small site).
export async function GET(request: Request): Promise<Response> {
  if (!checkSecret(request.headers.get("x-spike-secret")))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const collection = (params.get("collection") ?? "load-test") as keyof typeof schema;
  const source = params.get("source") === "cdn" ? "cdn" : "data";
  const concurrency = Number(params.get("c") ?? 4);
  const measured = createMeasuredFetch();
  const started = Date.now();
  let items = 0;
  let pages = 0;
  try {
    if (params.get("mode") === "pages") {
      const pageSize = Number(params.get("pageSize") ?? 5);
      const client = createWebflowClient({ concurrency, fetch: measured.fetch });
      const path = `/collections/${schema[collection].id}/items/live`;
      const page = (offset: number) =>
        client.request<WebflowListResponse<unknown>>(path, {
          host: source,
          query: { limit: pageSize, offset },
          init: { cache: "no-store" },
        });
      const first = await page(0);
      const offsets: number[] = [];
      for (let offset = pageSize; offset < first.pagination.total; offset += pageSize) offsets.push(offset);
      const rest = await Promise.all(offsets.map(page));
      items = first.items.length + rest.reduce((sum, next) => sum + next.items.length, 0);
      pages = offsets.length + 1;
    } else {
      const cms = createWebflow({ schema, source, concurrency, fetch: measured.fetch });
      items = (await cms.getItems(collection)).length;
      pages = measured.records.length;
    }
    return Response.json({
      ok: true,
      source,
      concurrency,
      items,
      pages,
      ms: Date.now() - started,
      requests: measured.records,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        ms: Date.now() - started,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        requests: measured.records,
      },
      { status: 500 },
    );
  }
}
