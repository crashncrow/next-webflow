import { http, HttpResponse } from "msw/http";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  WebflowConfigError,
  createWebflowCms,
  type WebflowCmsConfig,
  type WebflowItem,
  type WebflowRawItem,
  type WebflowSchema,
} from "../../src/core";
import { createFakeNextCache } from "../fake-next-cache";
import {
  POSTS_ID,
  SITE_ID,
  fullRawPost,
  postsCollectionResponse,
  rawPost,
  schema,
  sitesCollectionsResponse,
} from "../fixtures/schema";
import { CDN_API, DATA_API, TEST_TOKEN, server } from "../msw";

const LIVE = `${DATA_API}/collections/${POSTS_ID}/items/live`;
const list = (items: WebflowRawItem[], total = items.length) =>
  HttpResponse.json({ items, pagination: { limit: 100, offset: 0, total } });

function setup<S extends WebflowSchema | undefined = typeof schema>(
  config: WebflowCmsConfig<S> & { draft?: boolean } = {},
) {
  const cache = createFakeNextCache({ draft: config.draft ?? false });
  const logger = { warn: vi.fn() };
  const cms = createWebflowCms<S>({
    schema: schema as unknown as S,
    token: TEST_TOKEN,
    fetch: cache.fetch,
    cache: cache.adapter,
    logger,
    ...config,
  });
  return { cms, cache, logger };
}

describe("getItems", () => {
  it("reads live items, normalizes them and tags the request", async () => {
    server.use(http.get(LIVE, () => list([fullRawPost])));
    const { cms, cache } = setup();

    const posts = await cms.getItems("blog-posts");

    expect(posts).toHaveLength(1);
    expect(posts[0]?.fieldData.category).toEqual({ id: "opt-guides", name: "Guides" });
    expect(cache.requests[0]?.init.next?.tags).toEqual(["webflow", `webflow:collection:${POSTS_ID}`]);
    expect(cache.requests[0]?.init.cache).toBe("force-cache");
  });

  it("is typed from the schema", async () => {
    server.use(http.get(LIVE, () => list([fullRawPost])));
    const { cms } = setup();

    const [post] = await cms.getItems("blog-posts");
    expectTypeOf(post?.fieldData.postBody).toEqualTypeOf<string | undefined>();
    expectTypeOf(post?.fieldData.category.name).toEqualTypeOf<"News" | "Guides" | undefined>();
    // @ts-expect-error: unknown collection slugs are rejected.
    await expect(cms.getItems("nope")).rejects.toThrow();
  });

  it("maps camelCase filter keys to field slugs and forwards sorting", async () => {
    let search: URLSearchParams | undefined;
    server.use(
      http.get(LIVE, ({ request }) => {
        search = new URL(request.url).searchParams;
        return list([]);
      }),
    );
    const { cms } = setup();

    await cms.getItems("blog-posts", {
      filter: { readingTime: { gte: 5 }, category: { in: ["opt-news"] }, featured: undefined },
      sortBy: "lastPublished",
      sortOrder: "desc",
      cmsLocaleId: "locale-2",
    });

    expect(search?.get("filter[reading-time][gte]")).toBe("5");
    expect(search?.get("filter[category][in][0]")).toBe("opt-news");
    expect(search?.get("sortBy")).toBe("lastPublished");
    expect(search?.get("sortOrder")).toBe("desc");
    expect(search?.get("cmsLocaleId")).toBe("locale-2");
  });

  it("forwards limit to pagination", async () => {
    let limit: string | null = null;
    server.use(
      http.get(LIVE, ({ request }) => {
        limit = new URL(request.url).searchParams.get("limit");
        return list([rawPost()], 50);
      }),
    );
    const { cms } = setup();

    await cms.getItems("blog-posts", { limit: 20 });
    expect(limit).toBe("20");
  });

  it("returns API items untouched with { raw: true }", async () => {
    server.use(http.get(LIVE, () => list([fullRawPost])));
    const { cms } = setup();

    const posts = await cms.getItems("blog-posts", { raw: true });
    expect(posts[0]).toEqual(fullRawPost);
    expectTypeOf(posts).toEqualTypeOf<WebflowRawItem[]>();
  });

  it("reads from the Content Delivery API with source: cdn", async () => {
    server.use(http.get(`${CDN_API}/collections/${POSTS_ID}/items/live`, () => list([rawPost()])));
    const { cms } = setup({ source: "cdn" });

    await expect(cms.getItems("blog-posts")).resolves.toHaveLength(1);
  });
});

describe("getItemBySlug", () => {
  it("looks the slug up in one request, tagged with slug and collection", async () => {
    let slug: string | null = null;
    server.use(
      http.get(LIVE, ({ request }) => {
        slug = new URL(request.url).searchParams.get("slug");
        return list([rawPost()]);
      }),
    );
    const { cms, cache } = setup();

    const post = await cms.getItemBySlug("blog-posts", "hello-world");

    expect(slug).toBe("hello-world");
    expect(post?.fieldData.name).toBe("Hello world");
    expect(cache.requests).toHaveLength(1);
    expect(cache.requests[0]?.init.next?.tags).toEqual([
      "webflow",
      `webflow:collection:${POSTS_ID}`,
      `webflow:collection:${POSTS_ID}:slug:hello-world`,
    ]);
  });

  it("returns null when no item has that slug", async () => {
    server.use(http.get(LIVE, () => list([])));
    const { cms } = setup();
    await expect(cms.getItemBySlug("blog-posts", "missing")).resolves.toBeNull();
  });
});

describe("getItem", () => {
  it("reads a live item by ID, tagged with the item tag", async () => {
    server.use(http.get(`${DATA_API}/collections/${POSTS_ID}/items/item-1/live`, () => HttpResponse.json(rawPost())));
    const { cms, cache } = setup();

    const post = await cms.getItem("blog-posts", "item-1");

    expect(post?.id).toBe("item-1");
    expect(cache.requests[0]?.init.next?.tags).toEqual(["webflow", "webflow:item:item-1"]);
  });

  it("returns null for unknown or unpublished items (404)", async () => {
    server.use(
      http.get(`${DATA_API}/collections/${POSTS_ID}/items/item-9/live`, () =>
        HttpResponse.json({ code: "resource_not_found", message: "Not found", details: [] }, { status: 404 }),
      ),
    );
    const { cms } = setup();
    await expect(cms.getItem("blog-posts", "item-9")).resolves.toBeNull();
  });
});

describe("draft mode", () => {
  it("reads staged items from the Data API without caching", async () => {
    server.use(
      http.get(`${DATA_API}/collections/${POSTS_ID}/items`, () => list([rawPost({ isDraft: true })])),
      http.get(`${DATA_API}/collections/${POSTS_ID}/items/item-1`, () => HttpResponse.json(rawPost({ isDraft: true }))),
    );
    // Even with source: cdn, drafts come from the Data API.
    const { cms, cache } = setup({ draft: true, source: "cdn" });

    const [posts, post] = await Promise.all([cms.getItems("blog-posts"), cms.getItem("blog-posts", "item-1")]);

    expect(posts[0]?.isDraft).toBe(true);
    expect(post?.isDraft).toBe(true);
    expect(cache.requests.every((request) => request.init.cache === "no-store")).toBe(true);
  });
});

describe("schema fallback", () => {
  it("fetches the schema from the API when there is no generated one, and warns once", async () => {
    const calls = { collections: 0, collection: 0 };
    server.use(
      http.get(`${DATA_API}/sites/${SITE_ID}/collections`, () => {
        calls.collections++;
        return HttpResponse.json(sitesCollectionsResponse);
      }),
      http.get(`${DATA_API}/collections/${POSTS_ID}`, () => {
        calls.collection++;
        return HttpResponse.json(postsCollectionResponse);
      }),
      http.get(LIVE, () => list([rawPost({ fieldData: { subtitle: "Sub", category: "opt-tutorials" } })])),
    );
    const { cms, logger } = setup<undefined>({ schema: undefined, siteId: SITE_ID });

    const [post] = await cms.getItems("blog-posts");
    await cms.getItemBySlug("blog-posts", "hello-world");

    expect(post?.fieldData).toMatchObject({ subtitle: "Sub", category: { id: "opt-tutorials", name: "Tutorials" } });
    expect(calls).toEqual({ collections: 1, collection: 1 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/typegen/);
    expectTypeOf(post).toEqualTypeOf<WebflowItem | undefined>();
  });

  it("reads the site ID from WEBFLOW_SITE_ID", async () => {
    vi.stubEnv("WEBFLOW_SITE_ID", SITE_ID);
    server.use(
      http.get(`${DATA_API}/sites/${SITE_ID}/collections`, () => HttpResponse.json(sitesCollectionsResponse)),
      http.get(`${DATA_API}/collections/${POSTS_ID}`, () => HttpResponse.json(postsCollectionResponse)),
      http.get(LIVE, () => list([])),
    );
    const { cms } = setup<undefined>({ schema: undefined });
    await expect(cms.getItems("blog-posts")).resolves.toEqual([]);
  });

  it("explains how to fix a missing schema and site ID", async () => {
    vi.stubEnv("WEBFLOW_SITE_ID", "");
    const { cms } = setup<undefined>({ schema: undefined });

    const error = await cms.getItems("blog-posts").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebflowConfigError);
    expect((error as Error).message).toMatch(/typegen.*WEBFLOW_SITE_ID/s);
  });

  it("refreshes a stale generated schema from the API once, and warns", async () => {
    let schemaFetches = 0;
    server.use(
      http.get(`${DATA_API}/collections/${POSTS_ID}`, () => {
        schemaFetches++;
        return HttpResponse.json(postsCollectionResponse);
      }),
      http.get(LIVE, () => list([rawPost({ fieldData: { category: "opt-tutorials" } })])),
    );
    const { cms, logger } = setup();

    const [first] = await cms.getItems("blog-posts");
    const [second] = await cms.getItems("blog-posts");

    expect(first?.fieldData.category).toEqual({ id: "opt-tutorials", name: "Tutorials" });
    expect(second?.fieldData.category).toEqual({ id: "opt-tutorials", name: "Tutorials" });
    expect(schemaFetches).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/out of date.*unknown options in: category/);
  });

  it("caches the fetched schema under the collection tag", async () => {
    server.use(
      http.get(`${DATA_API}/collections/${POSTS_ID}`, () => HttpResponse.json(postsCollectionResponse)),
      http.get(LIVE, () => list([rawPost({ fieldData: { subtitle: "new field" } })])),
    );
    const { cms, cache } = setup();

    await cms.getItems("blog-posts");

    const schemaRequest = cache.requests.find((request) => request.url.endsWith(`/collections/${POSTS_ID}`));
    expect(schemaRequest?.init.next?.tags).toEqual(["webflow", `webflow:collection:${POSTS_ID}`]);
  });

  it("keeps serving items if the schema refresh fails", async () => {
    server.use(
      http.get(`${DATA_API}/collections/${POSTS_ID}`, () => HttpResponse.json({ message: "boom" }, { status: 400 })),
      http.get(LIVE, () => list([rawPost({ fieldData: { subtitle: "new field" } })])),
    );
    const { cms } = setup();

    const [post] = await cms.getItems("blog-posts");
    expect(post?.fieldData).toMatchObject({ subtitle: "new field" });
  });
});
