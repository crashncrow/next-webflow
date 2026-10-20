import { describe, expect, it } from "vitest";
import { collectionTag, itemTag, slugLookupTags, slugTag, tagsForEvent } from "../../src/core";

const item = (id: string, slug: string) => ({
  id,
  siteId: "site-1",
  workspaceId: "ws-1",
  collectionId: "col-1",
  cmsLocaleId: null,
  lastPublished: null,
  lastUpdated: "2026-10-01T00:00:00.000Z",
  createdOn: "2026-10-01T00:00:00.000Z",
  isArchived: false,
  isDraft: false,
  fieldData: { name: slug, slug },
});

describe("tag builders", () => {
  it("follow the documented convention", () => {
    expect(collectionTag("col-1")).toBe("webflow:collection:col-1");
    expect(itemTag("item-1")).toBe("webflow:item:item-1");
    expect(slugTag("col-1", "hello")).toBe("webflow:collection:col-1:slug:hello");
  });

  it("tag slug lookups with the collection too (slug changes)", () => {
    expect(slugLookupTags("col-1", "hello")).toEqual([
      "webflow",
      "webflow:collection:col-1",
      "webflow:collection:col-1:slug:hello",
    ]);
  });

  it("drop tags longer than Next.js accepts", () => {
    const tags = slugLookupTags("col-1", "x".repeat(300));
    expect(tags).toEqual(["webflow", "webflow:collection:col-1"]);
  });
});

describe("tagsForEvent", () => {
  it("site_publish invalidates the whole site", () => {
    expect(tagsForEvent({ triggerType: "site_publish", payload: { siteId: "site-1" } })).toEqual(["webflow"]);
  });

  it.each([
    "collection_item_created",
    "collection_item_changed",
    "collection_item_deleted",
    "collection_item_unpublished",
  ])("%s invalidates the collection, the item and its slug", (triggerType) => {
    expect(tagsForEvent({ triggerType, payload: item("item-1", "hello") })).toEqual([
      "webflow:collection:col-1",
      "webflow:item:item-1",
      "webflow:collection:col-1:slug:hello",
    ]);
  });

  it("collection_item_published invalidates every item in the array", () => {
    const tags = tagsForEvent({
      triggerType: "collection_item_published",
      payload: { items: [item("item-1", "a"), item("item-2", "b")] },
    });

    expect(tags).toEqual([
      "webflow:collection:col-1",
      "webflow:item:item-1",
      "webflow:collection:col-1:slug:a",
      "webflow:item:item-2",
      "webflow:collection:col-1:slug:b",
    ]);
  });

  it("ignores unrelated or malformed events", () => {
    expect(tagsForEvent({ triggerType: "form_submission", payload: {} })).toEqual([]);
    expect(tagsForEvent({ triggerType: "collection_item_changed", payload: null })).toEqual([]);
    expect(tagsForEvent({ triggerType: "collection_item_published", payload: { items: "nope" } })).toEqual([]);
    expect(tagsForEvent({})).toEqual([]);
  });

  it("works without a slug (e.g. localized payloads)", () => {
    const payload = { ...item("item-1", "hello"), fieldData: { "locale-1": { slug: "hola" } } };
    expect(tagsForEvent({ triggerType: "collection_item_changed", payload })).toEqual([
      "webflow:collection:col-1",
      "webflow:item:item-1",
    ]);
  });
});
