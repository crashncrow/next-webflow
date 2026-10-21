import { describe, expect, it } from "vitest";
import { collectionTag, itemTag, slugLookupTags, slugTag } from "../../src/core";

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
