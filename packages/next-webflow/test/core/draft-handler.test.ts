import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { createPreviewUrl, type WebflowItem } from "../../src/core";
import { createDraftRequestHandler, type DraftHandlerOptions } from "../../src/core/draft-handler";
import { POSTS_ID, SITE_ID, draftRawPost, schema, sitesCollectionsResponse } from "../fixtures/schema";
import { webflowError } from "../helpers";
import { DATA_API, TEST_TOKEN, server } from "../msw";

const SECRET = "preview-secret";
const NOW = Date.UTC(2026, 9, 21, 12);
const ROUTE = "https://example.com/api/webflow/draft";
const STAGED = `${DATA_API}/collections/${POSTS_ID}/items/:id`;

function setup(options: Partial<DraftHandlerOptions<typeof schema>> = {}) {
  const controls = { enable: vi.fn(async () => {}), disable: vi.fn(async () => {}) };
  const logger = { warn: vi.fn() };
  const resolvePath = vi.fn((collection: string, item: WebflowItem) => `/${collection}/${item.fieldData.slug}`);
  const handler = createDraftRequestHandler(
    { schema, token: TEST_TOKEN, secret: SECRET, resolvePath, logger, ...options },
    controls,
    { now: () => NOW },
  );
  return { handler, controls, logger, resolvePath };
}

const previewRequest = async (
  overrides: Partial<Parameters<typeof createPreviewUrl>[0]> = {},
  init?: { basePath?: string | undefined },
) => {
  const url = await createPreviewUrl({
    url: ROUTE,
    collection: "posts",
    itemId: draftRawPost.id,
    secret: SECRET,
    now: NOW,
    ...overrides,
  });
  const request = new Request(url);
  if (init?.basePath !== undefined) Object.assign(request, { nextUrl: { basePath: init.basePath } });
  return request;
};

function stagedItem(item = draftRawPost) {
  const requests: Array<{ url: string; cache: RequestCache | undefined }> = [];
  server.use(
    http.get(STAGED, ({ request, params }) => {
      requests.push({ url: request.url, cache: request.cache });
      return params.id === item.id
        ? HttpResponse.json(item)
        : HttpResponse.json(webflowError("resource_not_found", "Not found"), { status: 404 });
    }),
  );
  return requests;
}

describe("draft route: entering preview", () => {
  it("verifies the link, reads the STAGED item, enables draft mode and redirects to its current path", async () => {
    const requests = stagedItem({
      ...draftRawPost,
      fieldData: { ...draftRawPost.fieldData, slug: "renamed-in-draft" },
    });
    const { handler, controls, resolvePath } = setup();

    const response = await handler.GET(await previewRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/posts/renamed-in-draft");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(controls.enable).toHaveBeenCalledOnce();
    expect(resolvePath.mock.calls[0]?.[0]).toBe("posts");
    expect(requests[0]?.url).toBe(`${DATA_API}/collections/${POSTS_ID}/items/${draftRawPost.id}`); // staged, not /live
  });

  it("prefixes the base path: option, then the framework's, then nextUrl.basePath", async () => {
    stagedItem();
    const controls = { enable: async () => {}, disable: async () => {}, basePath: () => "/cloud" };
    const base = { schema, token: TEST_TOKEN, secret: SECRET, resolvePath: () => "/x" };
    const location = async (handler: ReturnType<typeof createDraftRequestHandler>, basePath?: string) =>
      (await handler.GET(await previewRequest({}, { basePath }))).headers.get("location");

    expect(
      await location(createDraftRequestHandler({ ...base, basePath: "/opt/" }, controls, { now: () => NOW })),
    ).toBe("/opt/x");
    expect(await location(createDraftRequestHandler(base, controls, { now: () => NOW }), "/req")).toBe("/cloud/x");
    expect(await location(setup({ resolvePath: () => "/x" }).handler, "/req")).toBe("/req/x");
    expect(await location(setup({ resolvePath: () => "/x" }).handler)).toBe("/x");
  });

  it.each([
    ["expired", { expiresIn: 1 }, NOW + 5_000, 401, /expired/],
    ["signed with another secret", { secret: "other" }, NOW, 401, /Invalid preview link/],
  ] as const)("rejects a link that is %s, without enabling draft mode", async (_, overrides, now, status, message) => {
    stagedItem();
    const controls = { enable: vi.fn(async () => {}), disable: vi.fn(async () => {}) };
    const handler = createDraftRequestHandler(
      { schema, token: TEST_TOKEN, secret: SECRET, resolvePath: () => "/" },
      controls,
      { now: () => now },
    );
    const response = await handler.GET(await previewRequest(overrides));
    expect(response.status).toBe(status);
    expect((await response.json()).error).toMatch(message);
    expect(controls.enable).not.toHaveBeenCalled();
  });

  it("rejects malformed links with 400", async () => {
    const { handler, controls } = setup();
    const response = await handler.GET(new Request(`${ROUTE}?collection=posts`));
    expect(response.status).toBe(400);
    expect(controls.enable).not.toHaveBeenCalled();
  });

  it("answers 404 when the item no longer exists", async () => {
    stagedItem();
    const { handler, controls } = setup();
    const response = await handler.GET(await previewRequest({ itemId: "deleted-item" }));
    expect(response.status).toBe(404);
    expect(controls.enable).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown collection", async () => {
    // Expected: no generated schema for "nope", so the CMS looks it up in the API first.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(http.get(`${DATA_API}/sites/${SITE_ID}/collections`, () => HttpResponse.json(sitesCollectionsResponse)));
    const { handler, logger } = setup({ siteId: SITE_ID });
    const response = await handler.GET(await previewRequest({ collection: "nope" }));
    expect(response.status).toBe(404);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/No generated schema for collection "nope"/));
    warn.mockRestore();
  });

  it("answers 500 with the setup error, not 404, when the token is missing", async () => {
    vi.stubEnv("WEBFLOW_CMS_TOKEN", "");
    const { handler, controls, logger } = setup({ token: undefined });
    const response = await handler.GET(await previewRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/isn't configured.*WEBFLOW_CMS_TOKEN/),
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/WEBFLOW_CMS_TOKEN/));
    expect(controls.enable).not.toHaveBeenCalled();
  });

  it("doesn't report a wrong site ID as an unknown collection", async () => {
    // Expected: no generated schema for "nope", so the CMS looks it up in the API first.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(
      http.get(`${DATA_API}/sites/:siteId/collections`, () =>
        HttpResponse.json(webflowError("resource_not_found", "Not found"), { status: 404 }),
      ),
    );
    const { handler } = setup({ siteId: "wrong-site" });
    await expect(handler.GET(await previewRequest({ collection: "nope" }))).rejects.toThrow(/Not found/);
    warn.mockRestore();
  });

  it("explains a missing resolvePath or secret (500)", async () => {
    stagedItem();
    const noPath = setup({ resolvePath: undefined });
    const response = await noPath.handler.GET(await previewRequest());
    expect([response.status, (await response.json()).error]).toEqual([500, expect.stringMatching(/pass resolvePath/)]);

    vi.stubEnv("WEBFLOW_PREVIEW_SECRET", "");
    const noSecret = setup({ secret: undefined });
    const missing = await noSecret.handler.GET(await previewRequest());
    expect([missing.status, (await missing.json()).error]).toEqual([
      500,
      expect.stringMatching(/WEBFLOW_PREVIEW_SECRET/),
    ]);
  });

  it("refuses a resolvePath that points off-site", async () => {
    stagedItem();
    const { handler, controls, logger } = setup({ resolvePath: () => "https://evil.com/x" });
    const response = await handler.GET(await previewRequest());
    expect(response.status).toBe(500);
    expect(controls.enable).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("draft route: leaving preview", () => {
  it.each([
    ["/blog/x", "/blog/x"],
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    [null, "/"],
  ])("GET ?disable=1&path=%s redirects to %s", async (path, location) => {
    const { handler, controls } = setup();
    const url = new URL(ROUTE);
    url.searchParams.set("disable", "1");
    if (path !== null) url.searchParams.set("path", path);
    const response = await handler.GET(new Request(url));
    expect(controls.disable).toHaveBeenCalledOnce();
    expect([response.status, response.headers.get("location")]).toEqual([307, location]);
  });

  it("needs no signature and keeps the base path", async () => {
    const { handler } = setup({ secret: undefined, resolvePath: undefined, basePath: undefined });
    const request = Object.assign(new Request(`${ROUTE}?disable=1&path=/blog`), { nextUrl: { basePath: "/app" } });
    expect((await handler.GET(request)).headers.get("location")).toBe("/app/blog");
  });

  it("DELETE disables without redirecting", async () => {
    const { handler, controls } = setup();
    const response = await handler.DELETE(new Request(ROUTE, { method: "DELETE" }));
    expect([response.status, await response.json()]).toEqual([200, { ok: true, draft: false }]);
    expect(controls.disable).toHaveBeenCalledOnce();
  });
});
