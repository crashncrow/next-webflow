import { describe, expect, it } from "vitest";
import { WebflowRateLimitError, createWebflowClient } from "../../src/core";

// Runs in Vitest's `edge-runtime` environment (Web API globals). That environment still
// leaks some Node globals, so the strict "no Node APIs" check lives in edge-compat.test.ts.
describe("client in an edge runtime", () => {
  it("paginates with a Web fetch", async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      const total = 150;
      const items = Array.from({ length: Math.min(limit, total - offset) }, (_, index) => ({
        id: `item-${offset + index}`,
      }));
      return Response.json({ items, pagination: { limit, offset, total } });
    };

    const client = createWebflowClient({ token: "test-token", fetch: fakeFetch });
    const result = await client.paginate<{ id: string }>("/collections/c1/items/live");

    expect(result.items).toHaveLength(150);
    expect(result.items.at(-1)?.id).toBe("item-149");
  });

  it("maps 429 to a typed error", async () => {
    const fakeFetch: typeof fetch = async () =>
      Response.json(
        { code: "too_many_requests", message: "Too Many Requests", details: [] },
        { status: 429, headers: { "retry-after": "60" } },
      );

    const client = createWebflowClient({ token: "test-token", fetch: fakeFetch, retry: false });
    await expect(client.request("/sites")).rejects.toBeInstanceOf(WebflowRateLimitError);
  });
});
