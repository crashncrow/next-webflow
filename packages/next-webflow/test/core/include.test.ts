import { http, HttpResponse } from "msw/http";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  WebflowConfigError,
  collectionTag,
  createWebflowCms,
  itemTag,
  type ItemOf,
  type WebflowCmsConfig,
  type WebflowRawItem,
} from "../../src/core";
import authorsLive from "../fixtures/api/authors-items-live.json";
import postsLive from "../fixtures/api/items-live.json";
import { AUTHORS_ID, POSTS_ID, schema } from "../fixtures/schema";
import { createFakeNextCache } from "../fake-next-cache";
import { webflowError } from "../helpers";
import { DATA_API, TEST_TOKEN, server } from "../msw";

const POSTS = postsLive.items as unknown as WebflowRawItem[];
const AUTHORS = authorsLive.items as unknown as WebflowRawItem[];
const [ALAN, GRACE, ADA] = AUTHORS as [WebflowRawItem, WebflowRawItem, WebflowRawItem];
const post = (slug: string) => POSTS.find((item) => item.fieldData.slug === slug) as WebflowRawItem;
const POSTS_LIVE = `${DATA_API}/collections/${POSTS_ID}/items/live`;
const AUTHORS_LIVE = `${DATA_API}/collections/${AUTHORS_ID}/items/live`;
const list = (items: WebflowRawItem[], total = items.length) =>
  HttpResponse.json({ items, pagination: { limit: 100, offset: 0, total } });
const notFound = () => HttpResponse.json(webflowError("resource_not_found", "Requested resource not found"), { status: 404 });

/** A fake site: posts as captured; authors live unless `unpublished` (mutable, to republish). */
function site({ unpublished = new Set<string>(), totalAuthors }: { unpublished?: Set<string>; totalAuthors?: number } = {}) {
  const calls = { authorsList: 0, authorById: [] as string[] };
  const live = () => AUTHORS.filter((author) => !unpublished.has(author.id));
  server.use(
    http.get(POSTS_LIVE, ({ request }) => {
      const slug = new URL(request.url).searchParams.get("slug");
      return list(slug ? POSTS.filter((item) => item.fieldData.slug === slug) : POSTS);
    }),
    http.get(`${DATA_API}/collections/${POSTS_ID}/items/:id/live`, ({ params }) => {
      const found = POSTS.find((item) => item.id === params.id);
      return found ? HttpResponse.json(found) : notFound();
    }),
    http.get(AUTHORS_LIVE, () => {
      calls.authorsList++;
      return list(live(), totalAuthors ?? live().length);
    }),
    http.get(`${DATA_API}/collections/${AUTHORS_ID}/items/:id/live`, ({ params }) => {
      calls.authorById.push(String(params.id));
      const found = live().find((author) => author.id === params.id);
      return found ? HttpResponse.json(found) : notFound();
    }),
    http.get(`${DATA_API}/collections/${AUTHORS_ID}/items/:id`, ({ params }) => {
      calls.authorById.push(`staged:${String(params.id)}`);
      const found = AUTHORS.find((author) => author.id === params.id);
      return found ? HttpResponse.json(found) : notFound();
    }),
  );
  return { calls, unpublished };
}

function setup(config: WebflowCmsConfig<typeof schema> & { draft?: boolean; build?: boolean } = {}) {
  const cache = createFakeNextCache({ draft: config.draft ?? false, build: config.build ?? false });
  const logger = { warn: vi.fn(), debug: vi.fn() };
  const cms = createWebflowCms({ schema, token: TEST_TOKEN, fetch: cache.fetch, cache: cache.adapter, logger, ...config });
  return { cms, cache, logger };
}

const names = (items: Array<{ fieldData: { name: string } }>) => items.map((item) => item.fieldData.name);

describe("include (whole referenced collection, under maxIncludeItems)", () => {
  it("replaces Reference and MultiReference fields with the referenced items, one request per collection", async () => {
    const { calls } = site();
    const { cms, cache } = setup();

    const posts = await cms.getItems("posts", { include: ["author", "coAuthors"] });
    const future = posts.find((item) => item.fieldData.slug === "cms-future-10");

    expect(future?.fieldData.author?.fieldData.name).toBe("Ada Lovelace");
    expect(names(future?.fieldData.coAuthors ?? [])).toEqual(["Grace Hopper", "Alan Turing"]);
    expect(calls.authorsList).toBe(1);
    expect(calls.authorById).toEqual([]);
    expect(cache.calls.find((call) => call.url.startsWith(AUTHORS_LIVE))?.tags).toEqual(["webflow", collectionTag(AUTHORS_ID)]);
  });

  it("gives null / [] for empty references", async () => {
    site();
    const { cms } = setup();
    const posts = await cms.getItems("posts", { include: ["author", "coAuthors"] });
    const untagged = posts.find((item) => item.fieldData.slug === "cms-user-training-8");
    expect(untagged?.fieldData.author).toBeNull();
    expect(untagged?.fieldData.coAuthors).toEqual([]);
    expect(posts.find((item) => item.fieldData.slug === "cms-trends-2023-5")?.fieldData.coAuthors).toEqual([]);
  });

  it("is typed: included fields become items (or null), the rest stay as they were", async () => {
    site();
    const { cms } = setup();
    const included = await cms.getItems("posts", { include: ["author", "coAuthors"] });
    type Author = ItemOf<typeof schema, "authors">;
    type Fields = (typeof included)[number]["fieldData"];
    expectTypeOf<Fields["author"]>().toEqualTypeOf<Author | null>();
    expectTypeOf<Fields["coAuthors"]>().toEqualTypeOf<Author[]>();
    expectTypeOf<Fields["body"]>().toEqualTypeOf<string>();
    expect(included).toHaveLength(POSTS.length);

    const plain = await cms.getItems("posts");
    expectTypeOf<(typeof plain)[number]["fieldData"]["author"]>().toEqualTypeOf<string | undefined>();
    expect(typeof plain[0]?.fieldData.author).toBe("string");
    // @ts-expect-error only Reference / MultiReference fields can be included
    await cms.getItems("posts", { include: ["body"] }).catch(() => undefined);
  });

  it("drops an unpublished co-author, and brings it back when republished (collection tag)", async () => {
    const { unpublished } = site({ unpublished: new Set([GRACE.id]) });
    const { cms, cache, logger } = setup();
    const render = async () =>
      names((await cms.getItemBySlug("posts", "cms-future-10", { include: ["coAuthors"] }))?.fieldData.coAuthors ?? []);

    expect(await render()).toEqual(["Alan Turing"]);
    expect(logger.debug.mock.calls.flat().join("\n")).toMatch(/"posts.coAuthors" are missing or unpublished/);

    // Republish → collection_item_published → webhook invalidates the authors collection tag.
    unpublished.delete(GRACE.id);
    cache.revalidateTag(collectionTag(AUTHORS_ID), itemTag(GRACE.id));
    expect(await render()).toEqual(["Grace Hopper", "Alan Turing"]);
  });

  it("works with getItem and getItemBySlug", async () => {
    site();
    const { cms } = setup();
    const future = post("cms-future-10");
    expect((await cms.getItem("posts", future.id, { include: ["author"] }))?.fieldData.author?.id).toBe(ADA.id);
    expect((await cms.getItemBySlug("posts", "cms-future-10", { include: ["author"] }))?.fieldData.author?.id).toBe(ADA.id);
  });
});

describe("include (by ID, over maxIncludeItems)", () => {
  it("fetches only the referenced items, each under its item tag", async () => {
    const { calls } = site({ totalAuthors: 5000 });
    const { cms, cache } = setup({ maxIncludeItems: 1000 });

    const item = await cms.getItemBySlug("posts", "cms-trends-2023-5", { include: ["author"] });

    expect(item?.fieldData.author?.fieldData.name).toBe("Ada Lovelace");
    expect(calls.authorById).toEqual([ADA.id]);
    expect(cache.calls.find((call) => call.url.endsWith(`/items/${ADA.id}/live`))?.tags).toEqual(["webflow", itemTag(ADA.id)]);
  });

  it("drops an unpublished co-author, keeps its item tag, and brings it back when republished", async () => {
    const { unpublished } = site({ unpublished: new Set([GRACE.id]), totalAuthors: 5000 });
    const { cms, cache } = setup({ maxIncludeItems: 1000 });
    const render = async () =>
      names((await cms.getItemBySlug("posts", "cms-future-10", { include: ["coAuthors"] }))?.fieldData.coAuthors ?? []);

    expect(await render()).toEqual(["Alan Turing"]);
    // The 404 for Grace still carried her item tag, so the page depends on it.
    expect(cache.calls.find((call) => call.url.endsWith(`/items/${GRACE.id}/live`))?.tags).toEqual(["webflow", itemTag(GRACE.id)]);

    unpublished.delete(GRACE.id);
    cache.revalidateTag(itemTag(GRACE.id));
    expect(await render()).toEqual(["Grace Hopper", "Alan Turing"]);
  });

  it("reads staged referenced items by ID in draft mode", async () => {
    const { calls } = site();
    server.use(http.get(`${DATA_API}/collections/${POSTS_ID}/items`, () => list([post("cms-future-10")])));
    const { cms } = setup({ draft: true });
    const [item] = await cms.getItems("posts", { include: ["author"] });
    expect(item?.fieldData.author?.id).toBe(ADA.id);
    expect(calls.authorById).toEqual([`staged:${ADA.id}`]);
    expect(calls.authorsList).toBe(0);
  });
});

describe("include errors", () => {
  it("rejects fields that aren't references, and raw: true", async () => {
    site();
    const { cms } = setup();
    await expect(cms.getItems("posts", { include: ["body" as "author"] })).rejects.toThrow(
      /"body" is not a Reference or MultiReference field of "posts"/,
    );
    await expect(
      cms.getItems("posts", { raw: true, include: ["author"] } as unknown as { raw: true }),
    ).rejects.toBeInstanceOf(WebflowConfigError);
  });
});

describe("build-time slug lookups (next build)", () => {
  it("serves every page's lookup from the cached list, with the list's tags, in one API request", async () => {
    site();
    const { cms, cache } = setup({ build: true });

    const pages = await Promise.all(["cms-future-10", "cms-trends-2023-5", "nope"].map((slug) => cms.getItemBySlug("posts", slug)));
    await cms.getItemBySlug("posts", "cms-customization-7");

    expect(pages.map((page) => page?.fieldData.slug ?? null)).toEqual(["cms-future-10", "cms-trends-2023-5", null]);
    const network = cache.requests.filter((request) => request.url.startsWith(POSTS_LIVE));
    expect(network.length).toBeLessThanOrEqual(3); // concurrent first renders may each miss once
    expect(cache.requests.some((request) => request.url.includes("slug="))).toBe(false);
    // Every lookup (cache hits included) passed the collection tags, so webhooks invalidate the pages.
    const lookups = cache.calls.filter((call) => call.url.startsWith(POSTS_LIVE));
    expect(lookups).toHaveLength(4);
    for (const call of lookups) expect(call.tags).toEqual(["webflow", collectionTag(POSTS_ID)]);
  });

  it("a page prerendered this way is invalidated by a collection_item_published after the build", async () => {
    site();
    const { cms, cache } = setup({ build: true });
    await cms.getItemBySlug("posts", "cms-future-10");
    const before = cache.requests.length;
    cache.revalidateTag(collectionTag(POSTS_ID), itemTag(post("cms-future-10").id)); // the webhook's tags
    await cms.getItemBySlug("posts", "cms-future-10");
    expect(cache.requests.length).toBe(before + 1);
  });

  it("warns above maxBuildListItems but keeps using the list", async () => {
    site();
    const { cms, cache, logger } = setup({ build: true, maxBuildListItems: 5 });
    await cms.getItemBySlug("posts", "cms-future-10");
    await cms.getItemBySlug("posts", "cms-trends-2023-5");
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]?.[0]).toMatch(/maxBuildListItems.*generateStaticParams.*dynamicParams.*buildSlugLookups: "request"/s);
    expect(cache.requests.some((request) => request.url.includes("slug="))).toBe(false);
  });

  it('uses one ?slug= request per page with buildSlugLookups: "request"', async () => {
    site();
    const { cms, cache } = setup({ build: true, buildSlugLookups: "request" });
    await cms.getItemBySlug("posts", "cms-future-10");
    expect(cache.requests.map((request) => new URL(request.url).searchParams.get("slug"))).toEqual(["cms-future-10"]);
  });

  it("isn't used outside builds", async () => {
    site();
    const { cms, cache } = setup();
    await cms.getItemBySlug("posts", "cms-future-10");
    expect(cache.requests.map((request) => new URL(request.url).searchParams.get("slug"))).toEqual(["cms-future-10"]);
  });
});

describe("Next.js data cache size limit", () => {
  it("warns once when a cached response is over 2 MB", async () => {
    const huge = { ...ALAN, fieldData: { ...ALAN.fieldData, name: "x".repeat(2.2 * 1024 * 1024) } };
    server.use(http.get(AUTHORS_LIVE, () => list([huge as WebflowRawItem])));
    const { cms, logger } = setup();
    await cms.getItems("authors");
    await cms.getItems("authors");
    expect(logger.warn.mock.calls.filter(([message]) => /2 MB limit/.test(String(message)))).toHaveLength(1);
  });
});
