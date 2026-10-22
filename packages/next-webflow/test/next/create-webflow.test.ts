import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { AUTHORS_ID, schema } from "../fixtures/schema";
import { DATA_API, TEST_TOKEN, server } from "../msw";

vi.mock("next/headers.js", () => ({ draftMode: async () => ({ isEnabled: false }) }));

describe("createWebflow", () => {
  it.each([
    ["without a cache option", {}],
    ["with an explicit cache: undefined", { cache: undefined }],
  ])("uses the Next.js data cache %s", async (_, extra) => {
    const { createWebflow } = await import("../../src/next");
    server.use(
      http.get(`${DATA_API}/collections/${AUTHORS_ID}/items/live`, () =>
        HttpResponse.json({ items: [], pagination: { limit: 100, offset: 0, total: 0 } }),
      ),
    );
    const inits: RequestInit[] = [];
    const fetchSpy: typeof fetch = (input, init) => {
      inits.push(init ?? {});
      return fetch(input, init);
    };

    await createWebflow({ schema, token: TEST_TOKEN, fetch: fetchSpy, ...extra }).getItems("authors");

    expect(inits).toHaveLength(1);
    expect(inits[0]).toMatchObject({
      cache: "force-cache",
      next: { tags: ["webflow", `webflow:collection:${AUTHORS_ID}`] },
    });
  });
});
