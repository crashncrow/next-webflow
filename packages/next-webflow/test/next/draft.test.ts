import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { POSTS_ID, draftRawPost, schema } from "../fixtures/schema";
import { DATA_API, TEST_TOKEN, server } from "../msw";

const draft = { enable: vi.fn(), disable: vi.fn(), isEnabled: false };
vi.mock("next/headers.js", () => ({ draftMode: async () => draft }));

describe("next-webflow/draft", () => {
  it("enables Next's draft mode on a valid link and disables it on exit", async () => {
    server.use(http.get(`${DATA_API}/collections/${POSTS_ID}/items/:id`, () => HttpResponse.json(draftRawPost)));
    const { createDraftHandler, createPreviewUrl } = await import("../../src/draft");
    const { GET, DELETE } = createDraftHandler({
      schema,
      token: TEST_TOKEN,
      secret: "s",
      resolvePath: (collection, item) => `/${collection}/${item.fieldData.slug}`,
    });

    const url = await createPreviewUrl({ url: "https://example.com/api/webflow/draft", collection: "posts", itemId: draftRawPost.id, secret: "s" });
    expect((await GET(new Request(url))).status).toBe(307);
    expect(draft.enable).toHaveBeenCalledOnce();

    await DELETE(new Request(url, { method: "DELETE" }));
    expect(draft.disable).toHaveBeenCalledOnce();
  });

  describe("base path (Webflow Cloud's mount): option → NEXT_PUBLIC_BASE_PATH → Next's internal", () => {
    const exitTo = async (options: { basePath?: string } = {}) => {
      const { createDraftHandler } = await import("../../src/draft");
      const { GET } = createDraftHandler({ resolvePath: () => "/", ...options });
      return (await GET(new Request("https://example.com/api/webflow/draft?disable=1&path=/blog"))).headers.get("location");
    };

    it("prefers the explicit option", async () => {
      vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/documented");
      vi.stubEnv("__NEXT_ROUTER_BASEPATH", "/internal");
      expect(await exitTo({ basePath: "/explicit" })).toBe("/explicit/blog");
    });

    it("then NEXT_PUBLIC_BASE_PATH (an empty value means a root mount)", async () => {
      vi.stubEnv("__NEXT_ROUTER_BASEPATH", "/internal");
      vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/documented");
      expect(await exitTo()).toBe("/documented/blog");
      vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
      expect(await exitTo()).toBe("/blog");
    });

    it("then the base path Next.js inlines", async () => {
      vi.stubEnv("NEXT_PUBLIC_BASE_PATH", undefined as unknown as string);
      vi.stubEnv("__NEXT_ROUTER_BASEPATH", "/internal");
      expect(await exitTo()).toBe("/internal/blog");
    });
  });

  it("doesn't export a runtime (edge returns 500 on Webflow Cloud)", async () => {
    const module: Record<string, unknown> = await import("../../src/draft");
    expect(module).not.toHaveProperty("runtime");
  });
});
