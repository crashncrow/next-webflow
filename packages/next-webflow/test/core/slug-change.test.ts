import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { createWebflowCms, tagsForEvent, type WebflowRawItem } from "../../src/core";
import { createFakeNextCache } from "../fake-next-cache";
import { POSTS_ID, fullRawPost, rawPost, schema } from "../fixtures/schema";
import { DATA_API, TEST_TOKEN, server } from "../msw";

/** The "Webflow site": one published post whose slug can be renamed. */
function publishedPost(initialSlug: string) {
  const state = { slug: initialSlug, lookups: 0 };
  const current = (): WebflowRawItem => rawPost({ fieldData: { slug: state.slug } });
  server.use(
    http.get(`${DATA_API}/collections/${POSTS_ID}/items/live`, ({ request }) => {
      state.lookups++;
      const slug = new URL(request.url).searchParams.get("slug");
      const items = slug === null || slug === state.slug ? [current()] : [];
      return HttpResponse.json({ items, pagination: { limit: 100, offset: 0, total: items.length } });
    }),
  );
  return { state, current };
}

describe("slug changes", () => {
  it("after a rename, the old slug resolves to null (notFound) and the new slug resolves", async () => {
    const site = publishedPost("old-slug");
    const cache = createFakeNextCache();
    const cms = createWebflowCms({ schema, token: TEST_TOKEN, fetch: cache.fetch, cache: cache.adapter });

    // Page for the old slug is rendered and cached.
    expect((await cms.getItemBySlug("posts", "old-slug"))?.id).toBe(fullRawPost.id);
    expect(await cms.getItemBySlug("posts", "old-slug")).not.toBeNull();
    expect(site.state.lookups).toBe(1);

    // The editor renames the slug and publishes. The webhook only carries the NEW slug.
    site.state.slug = "new-slug";
    const tags = tagsForEvent({
      triggerType: "collection_item_published",
      payload: { items: [{ ...site.current(), collectionId: POSTS_ID }] },
    });
    expect(tags).not.toContain(`webflow:collection:${POSTS_ID}:slug:old-slug`);
    cache.revalidateTag(...tags);

    // The old slug lookup was still invalidated (via the collection tag).
    expect(await cms.getItemBySlug("posts", "old-slug")).toBeNull();
    expect((await cms.getItemBySlug("posts", "new-slug"))?.fieldData.slug).toBe("new-slug");
  });

  it("an unrelated change elsewhere in the collection also invalidates slug lookups (documented trade-off)", async () => {
    const site = publishedPost("stable");
    const cache = createFakeNextCache();
    const cms = createWebflowCms({ schema, token: TEST_TOKEN, fetch: cache.fetch, cache: cache.adapter });

    await cms.getItemBySlug("posts", "stable");
    cache.revalidateTag(
      ...tagsForEvent({
        triggerType: "collection_item_changed",
        payload: { id: "item-2", collectionId: POSTS_ID, fieldData: { slug: "other" } },
      }),
    );
    await cms.getItemBySlug("posts", "stable");

    expect(site.state.lookups).toBe(2);
  });
});
