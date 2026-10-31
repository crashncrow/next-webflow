import { http, HttpResponse } from "msw/http";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  WebflowCollectionNotFoundError,
  WebflowConfigError,
  WebflowConflictError,
  WebflowNotFoundError,
  createWebflowCms,
  type OptionIdOf,
  type WebflowCmsConfig,
  type WebflowItem,
  type WebflowRawItem,
  type WebflowSchema,
} from "../../src/core";
import { createFakeNextCache } from "../fake-next-cache";
import {
  OPTIONS,
  POSTS_ID,
  SITE_ID,
  TUTORIALS_ID,
  draftRawPost,
  fullRawPost,
  postsCollectionResponse,
  rawPost,
  realPostsCollection,
  schema,
  sitesCollectionsResponse,
} from "../fixtures/schema";
import { webflowError } from "../helpers";
import { CDN_API, DATA_API, TEST_TOKEN, server } from "../msw";

const POST = fullRawPost;
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

    const posts = await cms.getItems("posts");

    expect(posts).toHaveLength(1);
    expect(posts[0]?.fieldData.category).toEqual(OPTIONS.guides);
    expect(cache.requests[0]?.init.next?.tags).toEqual(["webflow", `webflow:collection:${POSTS_ID}`]);
    expect(cache.requests[0]?.init.cache).toBe("force-cache");
  });

  it("is typed from the schema", async () => {
    server.use(http.get(LIVE, () => list([fullRawPost])));
    const { cms } = setup();

    const [post] = await cms.getItems("posts");
    expectTypeOf(post?.fieldData.body).toEqualTypeOf<string | undefined>();
    expectTypeOf(post?.fieldData.category?.name).toEqualTypeOf<"News" | "Guides" | undefined>();
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

    await cms.getItems("posts", {
      filter: { readingTime: { gte: 5 }, category: { in: [OPTIONS.news.id] }, featured: undefined },
      sortBy: "lastPublished",
      sortOrder: "desc",
      cmsLocaleId: "locale-2",
    });

    expect(search?.get("filter[reading-time][gte]")).toBe("5");
    expect(search?.get("filter[category][in][0]")).toBe(OPTIONS.news.id);
    expect(search?.get("sortBy")).toBe("lastPublished");
    expect(search?.get("sortOrder")).toBe("desc");
    expect(search?.get("cmsLocaleId")).toBe("locale-2");
  });

  it("types filters from the schema: field keys (camelCase or slug) and Option IDs", () => {
    const { cms } = setup();
    // Type checks only (`tsc` runs over the tests); never called, so no requests.
    const typeChecks = async () => {
      await cms.getItems("posts", {
        filter: { "reading-time": { gte: 5 }, category: { eq: OPTIONS.guides.id }, publishDate: { exists: true } },
      });
      // With `include`, `raw` and the plain operators of other field types too.
      await cms.getItems("posts", { include: ["author"], filter: { category: { nin: [OPTIONS.news.id] } } });
      await cms.getItems("posts", { raw: true, filter: { name: { contains: "x" } } });

      // @ts-expect-error a field the collection doesn't have
      await cms.getItems("posts", { filter: { featurd: { eq: true } } });
      // @ts-expect-error Option filters take option IDs, not names (Webflow returns nothing for a name)
      await cms.getItems("posts", { filter: { category: { eq: "News" } } });
      // @ts-expect-error in an `in` list too
      await cms.getItems("posts", { filter: { category: { in: [OPTIONS.news.id, "News"] } } });
      // @ts-expect-error Webflow doesn't accept `contains` on Option fields
      await cms.getItems("posts", { filter: { category: { contains: "a" } } });
      // @ts-expect-error filters belong to the collection: `authors` has no `category`
      await cms.getItems("authors", { filter: { category: { eq: OPTIONS.news.id } } });

      // A plain `string` (e.g. a route param) has to be narrowed to the option IDs first.
      const fromUrl: string = OPTIONS.news.id;
      // @ts-expect-error not narrowed
      await cms.getItems("posts", { filter: { category: { eq: fromUrl } } });
      const option = schema.posts.fields.category.options.find(({ id }) => id === fromUrl);
      if (option) await cms.getItems("posts", { filter: { category: { eq: option.id } } });

      // Without a schema, any key and value still go through.
      await createWebflowCms({ siteId: SITE_ID }).getItems("posts", { filter: { anything: { eq: "News" } } });
    };
    expect(typeChecks).toBeTypeOf("function");
    expectTypeOf<OptionIdOf<typeof schema, "posts", "category">>().toEqualTypeOf<
      typeof OPTIONS.news.id | typeof OPTIONS.guides.id
    >();
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

    await cms.getItems("posts", { limit: 20 });
    expect(limit).toBe("20");
  });

  it("returns API items untouched with { raw: true }", async () => {
    server.use(http.get(LIVE, () => list([fullRawPost])));
    const { cms } = setup();

    const posts = await cms.getItems("posts", { raw: true });
    expect(posts[0]).toEqual(fullRawPost);
    expectTypeOf(posts).toEqualTypeOf<WebflowRawItem[]>();
  });

  it("reads from the Content Delivery API with source: cdn", async () => {
    server.use(http.get(`${CDN_API}/collections/${POSTS_ID}/items/live`, () => list([rawPost()])));
    const { cms } = setup({ source: "cdn" });

    await expect(cms.getItems("posts")).resolves.toHaveLength(1);
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

    const post = await cms.getItemBySlug("posts", POST.fieldData.slug);

    expect(slug).toBe(POST.fieldData.slug);
    expect(post?.fieldData.name).toBe(POST.fieldData.name);
    // One item request, plus the collection schema for live Option names (the post has a category).
    const itemRequests = cache.requests.filter((request) => request.url.includes("/items"));
    expect(itemRequests).toHaveLength(1);
    expect(cache.requests.map((request) => request.url).filter((url) => !url.includes("/items"))).toEqual([
      `${DATA_API}/collections/${POSTS_ID}`,
    ]);
    expect(itemRequests[0]?.init.next?.tags).toEqual([
      "webflow",
      `webflow:collection:${POSTS_ID}`,
      `webflow:collection:${POSTS_ID}:slug:${POST.fieldData.slug}`,
    ]);
  });

  it("returns null when no item has that slug", async () => {
    server.use(http.get(LIVE, () => list([])));
    const { cms } = setup();
    await expect(cms.getItemBySlug("posts", "missing")).resolves.toBeNull();
  });
});

describe("getItem", () => {
  it("reads a live item by ID, tagged with the item tag", async () => {
    server.use(
      http.get(`${DATA_API}/collections/${POSTS_ID}/items/${POST.id}/live`, () => HttpResponse.json(rawPost())),
    );
    const { cms, cache } = setup();

    const post = await cms.getItem("posts", POST.id);

    expect(post?.id).toBe(POST.id);
    expect(cache.requests[0]?.init.next?.tags).toEqual(["webflow", `webflow:item:${POST.id}`]);
  });

  it("returns null for unknown or unpublished items (404)", async () => {
    server.use(
      http.get(`${DATA_API}/collections/${POSTS_ID}/items/item-9/live`, () =>
        HttpResponse.json({ code: "resource_not_found", message: "Not found", details: [] }, { status: 404 }),
      ),
    );
    const { cms } = setup();
    await expect(cms.getItem("posts", "item-9")).resolves.toBeNull();
  });
});

describe("draft mode", () => {
  it("reads staged items from the Data API without caching", async () => {
    server.use(
      http.get(`${DATA_API}/collections/${POSTS_ID}/items`, () => list([draftRawPost])),
      http.get(`${DATA_API}/collections/${POSTS_ID}/items/${draftRawPost.id}`, () => HttpResponse.json(draftRawPost)),
    );
    // Even with source: cdn, drafts come from the Data API.
    const { cms, cache } = setup({ draft: true, source: "cdn" });

    const [posts, post] = await Promise.all([cms.getItems("posts"), cms.getItem("posts", draftRawPost.id)]);

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
      http.get(LIVE, () => list([rawPost({ fieldData: { subtitle: "Sub", category: TUTORIALS_ID } })])),
    );
    const { cms, logger } = setup<undefined>({ schema: undefined, siteId: SITE_ID });

    const [post] = await cms.getItems("posts");
    await cms.getItemBySlug("posts", POST.fieldData.slug);

    expect(post?.fieldData).toMatchObject({ subtitle: "Sub", category: { id: TUTORIALS_ID, name: "Tutorials" } });
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
    await expect(cms.getItems("posts")).resolves.toEqual([]);
  });

  it("throws WebflowCollectionNotFoundError for a slug the site doesn't have", async () => {
    server.use(http.get(`${DATA_API}/sites/${SITE_ID}/collections`, () => HttpResponse.json(sitesCollectionsResponse)));
    const { cms } = setup<undefined>({ schema: undefined, siteId: SITE_ID });

    const error = await cms.getItems("nope").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebflowCollectionNotFoundError);
    expect(error).toBeInstanceOf(WebflowConfigError);
    expect(error).toMatchObject({ collection: "nope" });
  });

  it("explains how to fix a missing schema and site ID", async () => {
    vi.stubEnv("WEBFLOW_SITE_ID", "");
    const { cms } = setup<undefined>({ schema: undefined });

    const error = await cms.getItems("posts").catch((caught: unknown) => caught);
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
      http.get(LIVE, () => list([rawPost({ fieldData: { category: TUTORIALS_ID } })])),
    );
    const { cms, logger } = setup();

    const [first] = await cms.getItems("posts");
    const [second] = await cms.getItems("posts");

    expect(first?.fieldData.category).toEqual({ id: TUTORIALS_ID, name: "Tutorials" });
    expect(second?.fieldData.category).toEqual({ id: TUTORIALS_ID, name: "Tutorials" });
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

    await cms.getItems("posts");

    const schemaRequest = cache.requests.find((request) => request.url.endsWith(`/collections/${POSTS_ID}`));
    expect(schemaRequest?.init.next?.tags).toEqual(["webflow", `webflow:collection:${POSTS_ID}`]);
  });

  it("keeps serving items if the schema refresh fails; unknown Options get name: undefined", async () => {
    server.use(
      http.get(`${DATA_API}/collections/${POSTS_ID}`, () => HttpResponse.json({ message: "boom" }, { status: 400 })),
      http.get(LIVE, () => list([rawPost({ fieldData: { subtitle: "new field", category: TUTORIALS_ID } })])),
    );
    const { cms, logger } = setup();

    const [post] = await cms.getItems("posts");

    expect(post?.fieldData).toMatchObject({ subtitle: "new field" });
    expect(post?.fieldData.category).toEqual({ id: TUTORIALS_ID, name: undefined });
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    // The live Option names read fails first; the stale-schema refresh shares its warning.
    expect(warnings).toEqual([
      expect.stringMatching(/Could not fetch the live schema for "posts" \(boom/),
      expect.stringMatching(/out of date/),
      expect.stringMatching(/Unknown Option IDs in "posts" .*name: undefined/),
    ]);
  });

  it("does not warn about options once the refreshed schema resolves them", async () => {
    server.use(
      http.get(`${DATA_API}/collections/${POSTS_ID}`, () => HttpResponse.json(postsCollectionResponse)),
      http.get(LIVE, () => list([rawPost({ fieldData: { category: TUTORIALS_ID } })])),
    );
    const { cms, logger } = setup();

    await cms.getItems("posts");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("never-published collection (live list answers 404)", () => {
  const notFound = () =>
    HttpResponse.json(webflowError("resource_not_found", "Requested resource not found"), { status: 404 });

  function site({ exists = true } = {}) {
    const calls = { live: 0, collection: 0 };
    let published = false;
    server.use(
      http.get(LIVE, () => {
        calls.live++;
        if (!published) return notFound();
        return list([POST]);
      }),
      http.get(`${DATA_API}/collections/${POSTS_ID}`, () => {
        calls.collection++;
        return exists ? HttpResponse.json(postsCollectionResponse) : notFound();
      }),
      http.get(`${DATA_API}/sites/${SITE_ID}/collections`, () => HttpResponse.json(sitesCollectionsResponse)),
    );
    return { calls, publish: () => (published = true) };
  }

  it("returns [] / null when the collection exists, and logs once at debug level", async () => {
    site();
    const debug = vi.fn();
    const { cms, logger } = setup({ logger: { warn: vi.fn(), debug } });

    await expect(cms.getItems("posts")).resolves.toEqual([]);
    await expect(cms.getItemBySlug("posts", POST.fieldData.slug)).resolves.toBeNull();
    expect(debug).toHaveBeenCalledOnce();
    expect(debug.mock.calls[0]?.[0]).toMatch(/"posts" has never been published/);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("still tags the 404 request with the site and collection tags", async () => {
    site();
    const { cms, cache } = setup();
    await cms.getItems("posts");
    expect(cache.requests[0]?.init.next?.tags).toEqual(["webflow", `webflow:collection:${POSTS_ID}`]);
  });

  it("sees the published items as soon as site_publish invalidates (no memo outliving the webhook)", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 21), toFake: ["Date"] });
    const { calls, publish } = site();
    const { cms, cache } = setup();

    // Before the first publish: rendered empty (the 404 isn't cached, the page would be).
    await expect(cms.getItems("posts")).resolves.toEqual([]);

    // First site publish → webhook → revalidateTag("webflow") → the page regenerates 5 s later.
    publish();
    cache.revalidateTag("webflow");
    vi.setSystemTime(Date.now() + 5_000);
    await expect(cms.getItems("posts")).resolves.toHaveLength(1);
    expect(calls.live).toBe(2);

    // And the regenerated result is cached normally afterwards.
    await cms.getItems("posts");
    expect(calls.live).toBe(2);
    vi.useRealTimers();
  });

  it("asks Webflow again on every uncached read while the collection is unpublished", async () => {
    const { calls } = site();
    const { cms } = setup();
    await cms.getItems("posts");
    await cms.getItems("posts");
    expect(calls.live).toBe(2);
  });

  it("rethrows when the collection itself doesn't exist", async () => {
    site({ exists: false });
    const { cms } = setup();
    await expect(cms.getItems("posts")).rejects.toBeInstanceOf(WebflowNotFoundError);
  });

  it("confirms the collection through the schema fallback when there's no generated schema", async () => {
    const { calls } = site();
    const { cms } = setup<undefined>({ schema: undefined, siteId: SITE_ID });
    await expect(cms.getItems("posts")).resolves.toEqual([]);
    expect(calls.collection).toBe(1); // the fallback's schema request doubles as the existence check
  });

  it("doesn't apply to draft reads (staged items exist for unpublished collections)", async () => {
    server.use(http.get(`${DATA_API}/collections/${POSTS_ID}/items`, () => notFound()));
    const { cms } = setup({ draft: true });
    await expect(cms.getItems("posts")).rejects.toBeInstanceOf(WebflowNotFoundError);
  });
});

describe("never-published site (live reads answer 409)", () => {
  // The real response for a site that was never published (2026-10-25).
  const siteNotPublished = () =>
    HttpResponse.json(webflowError("conflict", "Conflict with server data: The site is not published."), {
      status: 409,
    });

  function site({ exists = true } = {}) {
    server.use(
      http.get(LIVE, siteNotPublished),
      http.get(`${DATA_API}/collections/${POSTS_ID}/items/:itemId/live`, siteNotPublished),
      http.get(`${DATA_API}/collections/${POSTS_ID}`, () =>
        exists
          ? HttpResponse.json(postsCollectionResponse)
          : HttpResponse.json(webflowError("resource_not_found", "Requested resource not found"), { status: 404 }),
      ),
    );
  }

  it("returns [] / null for lists, slug and ID lookups, and logs once at debug level", async () => {
    site();
    const debug = vi.fn();
    const { cms, logger } = setup({ logger: { warn: vi.fn(), debug } });

    await expect(cms.getItems("posts")).resolves.toEqual([]);
    await expect(cms.getItemBySlug("posts", POST.fieldData.slug)).resolves.toBeNull();
    await expect(cms.getItem("posts", POST.id)).resolves.toBeNull();
    expect(debug).toHaveBeenCalledOnce();
    expect(debug.mock.calls[0]?.[0]).toMatch(/site has never been published/);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("rethrows when the collection itself doesn't exist", async () => {
    site({ exists: false });
    const { cms } = setup();
    await expect(cms.getItems("posts")).rejects.toBeInstanceOf(WebflowNotFoundError);
  });

  it("doesn't apply to draft reads", async () => {
    server.use(http.get(`${DATA_API}/collections/${POSTS_ID}/items`, siteNotPublished));
    const { cms } = setup({ draft: true });
    await expect(cms.getItems("posts")).rejects.toBeInstanceOf(WebflowConflictError);
  });
});

it("retries a failed schema refresh on later reads and adopts the successful schema", async () => {
  let attempts = 0;
  server.use(
    http.get(`${DATA_API}/collections/${POSTS_ID}`, () =>
      ++attempts <= 2
        ? HttpResponse.json({ message: "temporarily unavailable" }, { status: 400 })
        : HttpResponse.json(postsCollectionResponse),
    ),
    http.get(LIVE, () => list([rawPost({ fieldData: { category: TUTORIALS_ID } })])),
  );
  // Only the stale-schema refresh here: live Option names would make their own schema requests.
  const { cms, logger } = setup({ optionNames: "generated" });
  for (let i = 0; i < 2; i++) {
    expect((await cms.getItems("posts"))[0]?.fieldData.category).toEqual({ id: TUTORIALS_ID, name: undefined });
  }
  expect((await cms.getItems("posts"))[0]?.fieldData.category).toEqual({ id: TUTORIALS_ID, name: "Tutorials" });
  expect((await cms.getItems("posts"))[0]?.fieldData.category).toEqual({ id: TUTORIALS_ID, name: "Tutorials" });
  expect(attempts).toBe(3);
  expect(logger.warn.mock.calls.filter(([message]) => String(message).includes("Could not fetch"))).toHaveLength(1);
});

describe("live Option names (optionNames)", () => {
  const SCHEMA_URL = `${DATA_API}/collections/${POSTS_ID}`;
  /** The real posts collection with the News option renamed in Webflow (same ID). */
  const withNewsNamed = (name: string) => ({
    ...realPostsCollection,
    fields: realPostsCollection.fields.map((field) =>
      field.slug === "category"
        ? {
            ...field,
            validations: {
              options: (field.validations?.options ?? []).map((option) =>
                option.id === OPTIONS.news.id ? { ...option, name } : option,
              ),
            },
          }
        : field,
    ),
  });
  const newsPost = () => rawPost({ fieldData: { category: OPTIONS.news.id } });

  it("shows an option renamed in Webflow without rerunning typegen, and warns once to update the types", async () => {
    server.use(
      http.get(SCHEMA_URL, () => HttpResponse.json(withNewsNamed("Noticias"))),
      http.get(LIVE, () => list([newsPost()])),
    );
    const { cms, cache, logger } = setup();

    const [first] = await cms.getItems("posts");
    const [second] = await cms.getItems("posts");

    expect(first?.fieldData.category).toEqual({ id: OPTIONS.news.id, name: "Noticias" });
    expect(second?.fieldData.category).toEqual({ id: OPTIONS.news.id, name: "Noticias" });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/renamed.*category: "News" → "Noticias".*typegen/);
    const schemaRequest = cache.requests.find((request) => request.url === SCHEMA_URL);
    expect(schemaRequest?.init.next?.tags).toEqual(["webflow", `webflow:collection:${POSTS_ID}`]);
  });

  it("picks up a later rename once the collection is invalidated (no in-memory copy outlives it)", async () => {
    let name = "News";
    server.use(
      http.get(SCHEMA_URL, () => HttpResponse.json(withNewsNamed(name))),
      http.get(LIVE, () => list([newsPost()])),
    );
    const { cms, cache } = setup();

    expect((await cms.getItems("posts"))[0]?.fieldData.category).toEqual(OPTIONS.news);
    name = "Noticias";
    expect((await cms.getItems("posts"))[0]?.fieldData.category).toEqual(OPTIONS.news); // still cached
    cache.revalidateTag("webflow"); // site_publish
    expect((await cms.getItems("posts"))[0]?.fieldData.category).toEqual({ id: OPTIONS.news.id, name: "Noticias" });
  });

  it("reads the schema only when the items have Option values", async () => {
    server.use(http.get(LIVE, () => list([rawPost({ fieldData: { category: null } })])));
    const { cms, cache } = setup();

    await cms.getItems("posts");

    expect(cache.requests.map((request) => request.url)).toEqual([`${LIVE}?offset=0&limit=100`]);
  });

  it('optionNames: "generated" uses only the generated names, with no schema request', async () => {
    server.use(
      http.get(SCHEMA_URL, () => HttpResponse.json(withNewsNamed("Noticias"))),
      http.get(LIVE, () => list([newsPost()])),
    );
    const { cms, cache, logger } = setup({ optionNames: "generated" });

    const [post] = await cms.getItems("posts");

    expect(post?.fieldData.category).toEqual(OPTIONS.news);
    expect(cache.requests.some((request) => request.url === SCHEMA_URL)).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to the generated names, with one warning, if the schema can't be read", async () => {
    server.use(
      http.get(SCHEMA_URL, () => HttpResponse.json({ message: "boom" }, { status: 400 })),
      http.get(LIVE, () => list([newsPost()])),
    );
    const { cms, logger } = setup();

    const [post] = await cms.getItems("posts");
    await cms.getItems("posts");

    expect(post?.fieldData.category).toEqual(OPTIONS.news);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/Could not fetch the live schema for "posts".*generated schema/);
  });
});
