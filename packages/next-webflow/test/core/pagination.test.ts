import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { WebflowNotFoundError } from "../../src/core";
import { createTestClient, delay, fakeItems, webflowError } from "../helpers";
import { DATA_API, server } from "../msw";

const ITEMS_PATH = "/collections/c1/items/live";

/** Simulates a collection of `total` items. Records every requested page. */
function collection(total: number, options: { latency?: (offset: number) => number } = {}) {
  const state = { requests: [] as Array<{ offset: number; limit: number }>, inFlight: 0, maxInFlight: 0 };
  server.use(
    http.get(`${DATA_API}${ITEMS_PATH}`, async ({ request }) => {
      const search = new URL(request.url).searchParams;
      const offset = Number(search.get("offset") ?? 0);
      const limit = Number(search.get("limit") ?? 100);
      state.requests.push({ offset, limit });
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await delay(options.latency?.(offset) ?? 5);
      state.inFlight--;
      const count = Math.max(0, Math.min(limit, total - offset));
      return HttpResponse.json({ items: fakeItems(offset, count), pagination: { limit, offset, total } });
    }),
  );
  return state;
}

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);
const range = (start: number, end: number) =>
  Array.from({ length: end - start }, (_, index) => `item-${start + index}`);

describe("paginate", () => {
  it("fetches every page in batches of 100", async () => {
    const state = collection(250);
    const { client } = createTestClient();

    const result = await client.paginate<{ id: string }>(ITEMS_PATH);

    expect(result.total).toBe(250);
    expect(ids(result.items)).toEqual(range(0, 250));
    expect(state.requests).toEqual([
      { offset: 0, limit: 100 },
      { offset: 100, limit: 100 },
      { offset: 200, limit: 50 },
    ]);
  });

  it("keeps page order when later pages resolve first", async () => {
    collection(400, { latency: (offset) => (offset === 100 ? 40 : 1) });
    const { client } = createTestClient();

    const result = await client.paginate<{ id: string }>(ITEMS_PATH);
    expect(ids(result.items)).toEqual(range(0, 400));
  });

  it("makes a single request when the limit fits in one page", async () => {
    const state = collection(250);
    const { client } = createTestClient();

    const result = await client.paginate<{ id: string }>(ITEMS_PATH, { limit: 20 });

    expect(ids(result.items)).toEqual(range(0, 20));
    expect(result.total).toBe(250);
    expect(state.requests).toEqual([{ offset: 0, limit: 20 }]);
  });

  it("respects limit and offset across pages", async () => {
    const state = collection(1000);
    const { client } = createTestClient();

    const result = await client.paginate<{ id: string }>(ITEMS_PATH, { offset: 50, limit: 150 });

    expect(ids(result.items)).toEqual(range(50, 200));
    expect(state.requests).toEqual([
      { offset: 50, limit: 100 },
      { offset: 150, limit: 50 },
    ]);
  });

  it("handles empty collections and offsets past the end", async () => {
    collection(0);
    const { client } = createTestClient();
    await expect(client.paginate(ITEMS_PATH)).resolves.toEqual({ items: [], total: 0 });

    collection(10);
    await expect(client.paginate(ITEMS_PATH, { offset: 50 })).resolves.toEqual({ items: [], total: 10 });
  });

  it("returns nothing without a request for limit 0", async () => {
    const state = collection(10);
    const { client } = createTestClient();
    await expect(client.paginate(ITEMS_PATH, { limit: 0 })).resolves.toEqual({ items: [], total: 0 });
    expect(state.requests).toHaveLength(0);
  });

  it("never exceeds the configured concurrency", async () => {
    const state = collection(2000, { latency: () => 10 });
    const { client } = createTestClient({ concurrency: 3 });

    const result = await client.paginate(ITEMS_PATH);

    expect(result.items).toHaveLength(2000);
    expect(state.requests).toHaveLength(20);
    expect(state.maxInFlight).toBe(3);
  });

  it("stays below Cloudflare's 6 concurrent requests by default", async () => {
    const state = collection(2000, { latency: () => 10 });
    const { client } = createTestClient();

    await client.paginate(ITEMS_PATH);
    expect(state.maxInFlight).toBeLessThan(6);
  });

  it("forwards the query on every page", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${DATA_API}${ITEMS_PATH}`, ({ request }) => {
        const search = new URL(request.url).searchParams;
        seen.push(search.get("sortBy") ?? "");
        const offset = Number(search.get("offset"));
        return HttpResponse.json({
          items: fakeItems(offset, 100),
          pagination: { limit: 100, offset, total: 200 },
        });
      }),
    );
    const { client } = createTestClient();

    await client.paginate(ITEMS_PATH, { query: { sortBy: "name" } });
    expect(seen).toEqual(["name", "name"]);
  });

  it("rejects when any page fails and never sends the queued pages", async () => {
    const received: number[] = [];
    server.use(
      http.get(`${DATA_API}${ITEMS_PATH}`, async ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get("offset"));
        received.push(offset);
        if (offset === 100) {
          return HttpResponse.json(webflowError("resource_not_found", "Gone"), { status: 404 });
        }
        if (offset > 0) await delay(50);
        return HttpResponse.json({
          items: fakeItems(offset, 100),
          pagination: { limit: 100, offset, total: 1000 },
        });
      }),
    );
    const { client } = createTestClient({ concurrency: 2 });

    await expect(client.paginate(ITEMS_PATH)).rejects.toBeInstanceOf(WebflowNotFoundError);
    await delay(100);
    // Pages already on the wire can't be recalled (the slot freed by the 404 may start one
    // more), but everything still queued is aborted before being sent.
    expect(received.length).toBeLessThanOrEqual(4);
    expect(received).not.toContain(900);
  });

  it("returns only the first page when the total is over stopIfTotalOver", async () => {
    const state = collection(250);
    const { client } = createTestClient();

    const over = await client.paginate<{ id: string }>(ITEMS_PATH, { stopIfTotalOver: 249 });
    expect(over.total).toBe(250);
    expect(ids(over.items)).toEqual(range(0, 100));
    expect(state.requests).toEqual([{ offset: 0, limit: 100 }]);

    const atLimit = await client.paginate<{ id: string }>(ITEMS_PATH, { stopIfTotalOver: 250 });
    expect(ids(atLimit.items)).toEqual(range(0, 250));
    expect(state.requests).toHaveLength(4);
  });

  it("validates limit and offset", async () => {
    const { client } = createTestClient();
    await expect(client.paginate(ITEMS_PATH, { limit: -1 })).rejects.toThrow(RangeError);
    await expect(client.paginate(ITEMS_PATH, { offset: 1.5 })).rejects.toThrow(RangeError);
  });
});
