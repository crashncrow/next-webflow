// Request URLs are the Next.js data cache keys: two reads share a cache entry only if their URLs
// match byte for byte. These tests pin every URL (and its tags) the CMS functions request, so a
// refactor of pagination or query building can't silently split or orphan cache entries.
import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { createWebflowCms, type GetItemsOptions, type WebflowCmsConfig } from "../../src/core";
import { createFakeNextCache } from "../fake-next-cache";
import { AUTHORS_ID, POSTS_ID, SITE_ID, schema } from "../fixtures/schema";
import { webflowError } from "../helpers";
import { CDN_API, DATA_API, TEST_TOKEN, server } from "../msw";

const POSTS = `${DATA_API}/collections/${POSTS_ID}`;
const AUTHORS = `${DATA_API}/collections/${AUTHORS_ID}`;
const SITE = "webflow";
const POSTS_TAG = `webflow:collection:${POSTS_ID}`;
const AUTHORS_TAG = `webflow:collection:${AUTHORS_ID}`;

const post = (index: number, authors: number) => ({
  id: `post-${index}`,
  fieldData: { name: `Post ${index}`, slug: `post-${index}`, author: `author-${index % authors}` },
});
const author = (index: number) => ({
  id: `author-${index}`,
  fieldData: { name: `Author ${index}`, slug: `author-${index}` },
});

/** A synthetic site with `posts` posts referencing `authors` authors, on both API hosts. */
function syntheticSite({ posts = 250, authors = 250 }: { posts?: number; authors?: number } = {}) {
  const items: Record<string, Array<{ id: string; fieldData: Record<string, unknown> }>> = {
    [POSTS_ID]: Array.from({ length: posts }, (_, index) => post(index, authors)),
    [AUTHORS_ID]: Array.from({ length: authors }, (_, index) => author(index)),
  };
  const notFound = () => HttpResponse.json(webflowError("resource_not_found", "Not found"), { status: 404 });
  const list = ({ request, params }: { request: Request; params: Record<string, unknown> }) => {
    const search = new URL(request.url).searchParams;
    const all = items[String(params.collectionId)] ?? [];
    const slug = search.get("slug");
    const matching = slug ? all.filter((item) => item.fieldData.slug === slug) : all;
    const offset = Number(search.get("offset") ?? 0);
    const limit = Number(search.get("limit") ?? 100);
    return HttpResponse.json({
      items: matching.slice(offset, offset + limit),
      pagination: { limit, offset, total: matching.length },
    });
  };
  const one = ({ params }: { params: Record<string, unknown> }) => {
    const found = (items[String(params.collectionId)] ?? []).find((item) => item.id === params.itemId);
    return found ? HttpResponse.json(found) : notFound();
  };
  server.use(
    ...[DATA_API, CDN_API].flatMap((api) => [
      http.get(`${api}/collections/:collectionId/items/live`, list),
      http.get(`${api}/collections/:collectionId/items`, list),
      http.get(`${api}/collections/:collectionId/items/:itemId/live`, one),
      http.get(`${api}/collections/:collectionId/items/:itemId`, one),
    ]),
    http.get(`${DATA_API}/sites/:siteId/collections`, () =>
      HttpResponse.json({ collections: [{ id: POSTS_ID, slug: "posts" }] }),
    ),
    http.get(`${DATA_API}/collections/:collectionId`, ({ params }) =>
      HttpResponse.json({
        id: params.collectionId,
        slug: "posts",
        fields: [
          { slug: "name", type: "PlainText", isRequired: true },
          { slug: "slug", type: "PlainText", isRequired: true },
          { slug: "author", type: "Reference", validations: { collectionId: AUTHORS_ID } },
        ],
      }),
    ),
  );
}

function setup(config: WebflowCmsConfig<typeof schema> & { draft?: boolean; build?: boolean } = {}) {
  const cache = createFakeNextCache({ draft: config.draft ?? false, build: config.build ?? false });
  const logger = { warn: vi.fn(), debug: vi.fn() };
  const cms = createWebflowCms({
    schema,
    token: TEST_TOKEN,
    fetch: cache.fetch,
    cache: cache.adapter,
    logger,
    ...config,
  });
  return { cms, cache, logger };
}

/** Every fetch issued (cache hits included), as `URL tags…`, sorted: parallel pages may start in any order. */
const keys = (calls: Array<{ url: string; tags: string[] }>) =>
  calls.map(({ url, tags }) => [url, ...tags].join(" ")).sort();

const page = (base: string, offset: number, limit = 100, prefix = "") =>
  `${base}/items/live?${prefix}offset=${offset}&limit=${limit}`;

describe("cache keys (exact request URLs and tags)", () => {
  it("getItems: pages of 100, the last one limited to what is left", async () => {
    syntheticSite();
    const { cms, cache } = setup();
    await cms.getItems("posts");
    expect(keys(cache.calls)).toEqual([
      `${page(POSTS, 0)} ${SITE} ${POSTS_TAG}`,
      `${page(POSTS, 100)} ${SITE} ${POSTS_TAG}`,
      `${page(POSTS, 200, 50)} ${SITE} ${POSTS_TAG}`,
    ]);
  });

  it("getItems: sort, locale, filters (camelCase or slug keys, undefined operators dropped), limit and offset", async () => {
    syntheticSite();
    const { cms, cache } = setup();
    await cms.getItems("posts", {
      sortBy: "name",
      sortOrder: "desc",
      cmsLocaleId: "loc-1",
      filter: {
        featured: { eq: true },
        "publish-date": { gte: "2026-01-01" },
        category: { in: ["a", "b"] },
        // Not allowed by the types (exactOptionalPropertyTypes), but JS callers can pass them.
        readingTime: { lt: undefined },
        accentColor: undefined,
      } as unknown as GetItemsOptions["filter"],
      limit: 150,
      offset: 10,
    });
    const query =
      "sortBy=name&sortOrder=desc&cmsLocaleId=loc-1" +
      "&filter%5Bfeatured%5D%5Beq%5D=true" +
      "&filter%5Bpublish-date%5D%5Bgte%5D=2026-01-01" +
      "&filter%5Bcategory%5D%5Bin%5D%5B0%5D=a&filter%5Bcategory%5D%5Bin%5D%5B1%5D=b";
    expect(keys(cache.calls)).toEqual([
      `${POSTS}/items/live?${query}&offset=10&limit=100 ${SITE} ${POSTS_TAG}`,
      `${POSTS}/items/live?${query}&offset=110&limit=50 ${SITE} ${POSTS_TAG}`,
    ]);
  });

  it("getItems: a filter whose operators are all undefined adds nothing", async () => {
    syntheticSite({ posts: 3 });
    const { cms, cache } = setup();
    await cms.getItems("posts", { filter: { featured: { eq: undefined } } as unknown as GetItemsOptions["filter"] });
    expect(keys(cache.calls)).toEqual([`${page(POSTS, 0)} ${SITE} ${POSTS_TAG}`]);
  });

  it("getItemBySlug at request time: one ?slug= lookup with the slug tag", async () => {
    syntheticSite();
    const { cms, cache } = setup();
    await cms.getItemBySlug("posts", "post-3");
    await cms.getItemBySlug("posts", "post-4", { cmsLocaleId: "loc-1" });
    expect(keys(cache.calls)).toEqual([
      `${POSTS}/items/live?slug=post-3 ${SITE} ${POSTS_TAG} ${POSTS_TAG}:slug:post-3`,
      `${POSTS}/items/live?slug=post-4&cmsLocaleId=loc-1 ${SITE} ${POSTS_TAG} ${POSTS_TAG}:slug:post-4`,
    ]);
  });

  it("getItemBySlug during the build: the same page URLs as getItems", async () => {
    syntheticSite();
    const { cms, cache } = setup({ build: true });
    await cms.getItemBySlug("posts", "post-3");
    const lookup = keys(cache.calls);
    cache.calls.length = 0;
    await cms.getItems("posts");
    expect(lookup).toEqual(keys(cache.calls));
    expect(lookup).toEqual([
      `${page(POSTS, 0)} ${SITE} ${POSTS_TAG}`,
      `${page(POSTS, 100)} ${SITE} ${POSTS_TAG}`,
      `${page(POSTS, 200, 50)} ${SITE} ${POSTS_TAG}`,
    ]);
  });

  it("getItem: the item URL with the item tag", async () => {
    syntheticSite();
    const { cms, cache } = setup();
    await cms.getItem("posts", "post-3", { cmsLocaleId: "loc-1" });
    expect(keys(cache.calls)).toEqual([`${POSTS}/items/post-3/live?cmsLocaleId=loc-1 ${SITE} webflow:item:post-3`]);
  });

  it("include, whole collection: the referenced collection's pages, shared with getItems", async () => {
    syntheticSite();
    const { cms, cache } = setup();
    await cms.getItems("posts", { include: ["author"], limit: 5 });
    const included = keys(cache.calls);
    expect(included).toEqual([
      `${page(AUTHORS, 0)} ${SITE} ${AUTHORS_TAG}`,
      `${page(AUTHORS, 100)} ${SITE} ${AUTHORS_TAG}`,
      `${page(AUTHORS, 200, 50)} ${SITE} ${AUTHORS_TAG}`,
      `${page(POSTS, 0, 5)} ${SITE} ${POSTS_TAG}`,
    ]);
    cache.calls.length = 0;
    await cms.getItems("authors");
    expect(keys(cache.calls)).toEqual(included.filter((key) => key.startsWith(AUTHORS)));
  });

  it("include, whole collection, with a locale", async () => {
    syntheticSite();
    const { cms, cache } = setup();
    await cms.getItems("posts", { include: ["author"], limit: 5, cmsLocaleId: "loc-1" });
    const locale = "cmsLocaleId=loc-1&";
    expect(keys(cache.calls)).toEqual([
      `${page(AUTHORS, 0, 100, locale)} ${SITE} ${AUTHORS_TAG}`,
      `${page(AUTHORS, 100, 100, locale)} ${SITE} ${AUTHORS_TAG}`,
      `${page(AUTHORS, 200, 50, locale)} ${SITE} ${AUTHORS_TAG}`,
      `${page(POSTS, 0, 5, locale)} ${SITE} ${POSTS_TAG}`,
    ]);
  });

  it("include above maxIncludeItems: the first page, then each referenced item by ID", async () => {
    syntheticSite();
    const { cms, cache, logger } = setup({ maxIncludeItems: 100 });
    await cms.getItems("posts", { include: ["author"], limit: 2 });
    expect(logger.debug).toHaveBeenCalledOnce();
    expect(keys(cache.calls)).toEqual([
      `${AUTHORS}/items/author-0/live ${SITE} webflow:item:author-0`,
      `${AUTHORS}/items/author-1/live ${SITE} webflow:item:author-1`,
      `${page(AUTHORS, 0)} ${SITE} ${AUTHORS_TAG}`,
      `${page(POSTS, 0, 2)} ${SITE} ${POSTS_TAG}`,
    ]);
  });

  it("draft mode: staged endpoints", async () => {
    syntheticSite();
    const { cms, cache } = setup({ draft: true });
    await cms.getItems("posts", { include: ["author"], limit: 2 });
    await cms.getItemBySlug("posts", "post-3");
    await cms.getItem("posts", "post-4");
    expect(cache.calls.map((call) => call.url).sort()).toEqual([
      `${AUTHORS}/items/author-0`,
      `${AUTHORS}/items/author-1`,
      `${POSTS}/items/post-4`,
      `${POSTS}/items?offset=0&limit=2`,
      `${POSTS}/items?slug=post-3`,
    ]);
  });

  it("source: cdn uses the CDN host with the same paths", async () => {
    syntheticSite();
    const { cms, cache } = setup({ source: "cdn" });
    await cms.getItems("posts", { limit: 2 });
    await cms.getItemBySlug("posts", "post-3");
    await cms.getItem("posts", "post-4");
    const CDN_POSTS = `${CDN_API}/collections/${POSTS_ID}`;
    expect(cache.calls.map((call) => call.url).sort()).toEqual([
      `${CDN_POSTS}/items/live?offset=0&limit=2`,
      `${CDN_POSTS}/items/live?slug=post-3`,
      `${CDN_POSTS}/items/post-4/live`,
    ]);
  });

  it("schema fallback without a generated schema", async () => {
    syntheticSite({ posts: 3 });
    const cache = createFakeNextCache();
    const cms = createWebflowCms({
      siteId: SITE_ID,
      token: TEST_TOKEN,
      fetch: cache.fetch,
      cache: cache.adapter,
      logger: { warn: () => {} },
    });
    await cms.getItems("posts");
    expect(keys(cache.calls)).toEqual([
      `${DATA_API}/collections/${POSTS_ID} ${SITE} ${POSTS_TAG}`,
      `${page(POSTS, 0)} ${SITE} ${POSTS_TAG}`,
      `${DATA_API}/sites/${SITE_ID}/collections ${SITE}`,
    ]);
  });
});
