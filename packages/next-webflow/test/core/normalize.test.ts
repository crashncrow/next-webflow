import { describe, expect, expectTypeOf, it } from "vitest";
import { camelCase, normalizeItem, schemaFromApi, type ItemOf, type WebflowImage } from "../../src/core";
import { AUTHORS_ID, POSTS_ID, fullRawPost, postsCollectionResponse, rawPost, schema } from "../fixtures/schema";

const posts = schema["blog-posts"];

describe("camelCase", () => {
  it.each([
    ["post-body", "postBody"],
    ["name", "name"],
    ["image-2", "image2"],
    ["co-authors", "coAuthors"],
    ["seo_title", "seoTitle"],
  ])("%s → %s", (slug, expected) => {
    expect(camelCase(slug)).toBe(expected);
  });
});

describe("normalizeItem", () => {
  it("camelCases keys and keeps every field type's value", () => {
    const { item, mismatch } = normalizeItem(fullRawPost, posts);

    expect(mismatch).toBeUndefined();
    expect(item).toMatchObject({
      id: "item-1",
      cmsLocaleId: "locale-1",
      isDraft: false,
      fieldData: {
        name: "Hello world",
        slug: "hello-world",
        postBody: "<p>Hi</p>",
        mainImage: { fileId: "file-1", url: "https://cdn.example/a.jpg", alt: "A" },
        gallery: [
          { fileId: "file-2", url: "https://cdn.example/b.jpg", alt: null },
          { fileId: "file-3", url: "https://cdn.example/c.jpg" },
        ],
        video: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
        website: "https://webflow.com",
        contactEmail: "hi@example.com",
        phone: "+15550000000",
        readingTime: 7,
        publishedOn: "2026-10-01T00:00:00.000Z",
        featured: true,
        accentColor: "#FFFF00",
        attachment: { fileId: "file-4", url: "https://cdn.example/d.pdf" },
        author: "author-1",
        coAuthors: ["author-2", "author-3"],
        externalAsset: { anything: true },
      },
    });
  });

  it("translates Option IDs to { id, name }", () => {
    const { item } = normalizeItem(fullRawPost, posts);
    expect(item.fieldData.category).toEqual({ id: "opt-guides", name: "Guides" });
  });

  it("drops null and missing optional fields", () => {
    const { item } = normalizeItem(rawPost({ fieldData: { "main-image": null } }), posts);
    expect(item.fieldData).not.toHaveProperty("mainImage");
    expect(item.fieldData).not.toHaveProperty("video");
  });

  it("reports unknown fields and Option IDs (stale schema) but keeps the data", () => {
    const { item, mismatch } = normalizeItem(
      rawPost({ fieldData: { subtitle: "New field", category: "opt-tutorials" } }),
      posts,
    );

    expect(mismatch).toEqual({
      unknownFields: ["subtitle"],
      unknownOptions: [{ field: "category", id: "opt-tutorials" }],
    });
    expect(item.fieldData).toMatchObject({ subtitle: "New field", category: { id: "opt-tutorials" } });
  });

  it("ignores underscore metadata keys such as _locale", () => {
    const { mismatch } = normalizeItem(rawPost({ fieldData: { _locale: "locale-1" } }), posts);
    expect(mismatch).toBeUndefined();
  });

  it("defaults a missing cmsLocaleId to null", () => {
    const raw = rawPost();
    delete raw.cmsLocaleId;
    expect(normalizeItem(raw, posts).item.cmsLocaleId).toBeNull();
  });
});

describe("schemaFromApi", () => {
  it("builds the runtime schema from GET /collections/{id}", () => {
    const result = schemaFromApi(postsCollectionResponse);

    expect(result.id).toBe(POSTS_ID);
    expect(result.slug).toBe("blog-posts");
    expect(result.fields.postBody).toEqual({ slug: "post-body", type: "RichText", required: true });
    expect(result.fields.category?.options).toHaveLength(3);
  });

  it("reads the referenced collection from metadata or validations", () => {
    const result = schemaFromApi(postsCollectionResponse);
    expect(result.fields.author?.collectionId).toBe(AUTHORS_ID);
    expect(result.fields.coAuthors?.collectionId).toBe(AUTHORS_ID);
  });
});

describe("item types inferred from the schema", () => {
  type Post = ItemOf<typeof schema, "blog-posts">;

  it("types required fields as present and optional ones as optional", () => {
    expectTypeOf<Post["fieldData"]["postBody"]>().toEqualTypeOf<string>();
    expectTypeOf<Post["fieldData"]["mainImage"]>().toEqualTypeOf<WebflowImage | undefined>();
    expectTypeOf<Post["fieldData"]["readingTime"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Post["fieldData"]["coAuthors"]>().toEqualTypeOf<string[] | undefined>();
    expectTypeOf<Post["fieldData"]["externalAsset"]>().toEqualTypeOf<unknown>();
  });

  it("types Options as the exact { id, name } pairs", () => {
    expectTypeOf<Post["fieldData"]["category"]>().toEqualTypeOf<
      { id: "opt-news"; name: "News" } | { id: "opt-guides"; name: "Guides" }
    >();
  });
});
