import { describe, expect, expectTypeOf, it } from "vitest";
import {
  camelCase,
  normalizeItem,
  schemaFromApi,
  type CollectionSchema,
  type ItemOf,
  type UnknownOption,
  type WebflowImageValue,
  type WebflowVideoValue,
} from "../../src/core";
import {
  AUTHORS_ID,
  OPTIONS,
  POSTS_ID,
  TUTORIALS_ID,
  fullRawPost,
  liveItems,
  postsCollectionResponse,
  rawPost,
  realPostsCollection,
  schema,
  sparseRawPost,
} from "../fixtures/schema";

type Post = ItemOf<typeof schema, "posts">;

const posts = schema.posts;
const raw = fullRawPost.fieldData;
const normalizePost = (item: typeof fullRawPost) => normalizeItem<Post["fieldData"]>(item, posts).item;

describe("camelCase", () => {
  it.each([
    ["post-body", "postBody"],
    ["name", "name"],
    ["image-2", "image2"],
    ["co-authors", "coAuthors"],
    ["seo_title", "seoTitle"],
    ["thumbnail_url", "thumbnailUrl"],
  ])("%s → %s", (slug, expected) => {
    expect(camelCase(slug)).toBe(expected);
  });
});

describe("normalizeItem (real items)", () => {
  it("camelCases keys and keeps every field type's value", () => {
    const { item, mismatch } = normalizeItem(fullRawPost, posts);

    expect(mismatch).toBeUndefined();
    expect(item).toMatchObject({
      id: fullRawPost.id,
      cmsLocaleId: fullRawPost.cmsLocaleId,
      isDraft: false,
      fieldData: {
        name: raw.name,
        slug: raw.slug,
        body: raw.body,
        mainImage: raw["main-image"],
        gallery: raw.gallery,
        website: raw.website,
        contactEmail: raw["contact-email"],
        phone: raw.phone,
        readingTime: raw["reading-time"],
        publishDate: raw["publish-date"],
        featured: true,
        accentColor: raw["accent-color"],
        attachment: raw.attachment,
        author: raw.author,
        coAuthors: raw["co-authors"],
      },
    });
  });

  it("translates Option IDs to { id, name }", () => {
    const { item } = normalizeItem(fullRawPost, posts);
    expect(item.fieldData.category).toEqual(OPTIONS.guides);
  });

  it("drops the null values the API returns for empty fields", () => {
    expect(sparseRawPost.fieldData["main-image"]).toBeNull();
    const { item } = normalizeItem(sparseRawPost, posts);
    for (const key of ["mainImage", "video", "publishDate", "category", "author", "coAuthors"]) {
      expect(item.fieldData).not.toHaveProperty(key);
    }
  });

  it("normalizes every live item with the real schema without mismatches", () => {
    const realSchema = schemaFromApi(realPostsCollection);
    expect(liveItems.map((item) => normalizeItem(item, realSchema).mismatch).filter(Boolean)).toEqual([]);
  });

  it("keeps a null lastPublished (seen on live items in the fixtures)", () => {
    expect(normalizeItem(fullRawPost, posts).item.lastPublished).toBeNull();
  });

  it("reports unknown fields and Option IDs (stale schema) but keeps the data", () => {
    const { item, mismatch } = normalizeItem(
      rawPost({ fieldData: { subtitle: "New field", category: TUTORIALS_ID } }),
      posts,
    );

    expect(mismatch).toEqual({
      unknownFields: ["subtitle"],
      unknownOptions: [{ field: "category", id: TUTORIALS_ID }],
    });
    expect(item.fieldData).toMatchObject({ subtitle: "New field" });
    expect(item.fieldData.category).toEqual({ id: TUTORIALS_ID, name: undefined });
  });

  it("ignores underscore metadata keys such as _locale", () => {
    const { mismatch } = normalizeItem(rawPost({ fieldData: { _locale: fullRawPost.cmsLocaleId } }), posts);
    expect(mismatch).toBeUndefined();
  });

  it("defaults a missing cmsLocaleId to null", () => {
    const item = rawPost();
    delete item.cmsLocaleId;
    expect(normalizeItem(item, posts).item.cmsLocaleId).toBeNull();
  });

  it("keeps ExtFileRef values untouched (not creatable on the test site)", () => {
    const withExt: CollectionSchema = {
      ...posts,
      fields: { ...posts.fields, externalAsset: { slug: "external-asset", type: "ExtFileRef", required: false } },
    };
    const { item, mismatch } = normalizeItem(rawPost({ fieldData: { "external-asset": { anything: true } } }), withExt);
    expect(mismatch).toBeUndefined();
    expect(item.fieldData.externalAsset).toEqual({ anything: true });
  });
});

describe("Webflow's inherit-alt placeholder", () => {
  const fields = (fieldData: Record<string, unknown>) => normalizeItem(rawPost({ fieldData }), posts).item.fieldData;
  const inherit = (url: string) => ({ fileId: "f", url, alt: "__wf_reserved_inherit" });

  it("becomes alt: null in Image, MultiImage and File fields, never a string to render", () => {
    expect(
      fields({
        "main-image": inherit("a.jpg"),
        gallery: [inherit("b.jpg"), { fileId: "g", url: "c.jpg", alt: "C" }],
        attachment: inherit("d.pdf"),
      }),
    ).toMatchObject({
      mainImage: { fileId: "f", url: "a.jpg", alt: null },
      gallery: [
        { url: "b.jpg", alt: null },
        { url: "c.jpg", alt: "C" },
      ],
      attachment: { url: "d.pdf", alt: null },
    });
  });
});

describe("VideoLink", () => {
  const video = (value: unknown) => normalizeItem(rawPost({ fieldData: { video: value } }), posts).item.fieldData.video;

  it("turns the real { url, metadata } into camelCase metadata", () => {
    const result = normalizePost(fullRawPost).fieldData.video;

    expect(result).toEqual({
      url: "https://vimeo.com/114900089",
      metadata: expect.objectContaining({
        type: "video",
        title: "A Brief Lesson on Color Theory",
        authorName: "Rhea Lelina Manglapus",
        providerName: "Vimeo",
        thumbnailUrl: "https://i.vimeocdn.com/video/556340000_1280.jpg",
        width: 1920,
        height: 1080,
        html: expect.stringContaining("<iframe"),
      }),
    });
    expect(Object.keys(result?.metadata ?? {}).filter((key) => key.includes("_"))).toEqual([]);
  });

  it("computes aspectRatio from width/height instead of trusting the API (which sends 0)", () => {
    expect((raw.video as { metadata: { aspectRatio: number } }).metadata.aspectRatio).toBe(0);
    expect(normalizePost(fullRawPost).fieldData.video?.metadata?.aspectRatio).toBeCloseTo(16 / 9);
  });

  it("omits aspectRatio when the size is unknown, and drops null metadata", () => {
    expect(video({ url: "https://youtu.be/x", metadata: { aspectRatio: 0, width: null, title: "T" } })).toEqual({
      url: "https://youtu.be/x",
      metadata: { title: "T" },
    });
  });

  it("accepts a plain URL (the write format) and a value without metadata", () => {
    expect(video("https://youtu.be/x")).toEqual({ url: "https://youtu.be/x" });
    expect(video({ url: "https://youtu.be/x" })).toEqual({ url: "https://youtu.be/x" });
  });

  it("leaves unexpected shapes untouched", () => {
    expect(video({ href: "nope" })).toEqual({ href: "nope" });
  });
});

describe("schemaFromApi (real collection)", () => {
  it("produces exactly the schema typegen emits", () => {
    expect(schemaFromApi(realPostsCollection)).toEqual(posts);
  });

  it("reads the referenced collection from validations (where the real API puts it)", () => {
    const result = schemaFromApi(realPostsCollection);
    expect(result.fields.author?.collectionId).toBe(AUTHORS_ID);
    expect(result.fields.coAuthors?.collectionId).toBe(AUTHORS_ID);
  });

  it("falls back to metadata.collectionId (shown in some docs examples)", () => {
    const result = schemaFromApi({
      id: POSTS_ID,
      fields: [{ slug: "author", type: "Reference", metadata: { collectionId: AUTHORS_ID } }],
    });
    expect(result.fields.author?.collectionId).toBe(AUTHORS_ID);
  });

  it("picks up fields and options added after typegen", () => {
    const result = schemaFromApi(postsCollectionResponse);
    expect(result.fields.subtitle).toEqual({ slug: "subtitle", type: "PlainText", required: false });
    expect(result.fields.category?.options).toHaveLength(3);
  });
});

describe("item types inferred from the schema", () => {
  it("types required fields as present and optional ones as optional", () => {
    expectTypeOf<Post["fieldData"]["body"]>().toEqualTypeOf<string>();
    expectTypeOf<Post["fieldData"]["mainImage"]>().toEqualTypeOf<WebflowImageValue | undefined>();
    expectTypeOf<Post["fieldData"]["video"]>().toEqualTypeOf<WebflowVideoValue | undefined>();
    expectTypeOf<Post["fieldData"]["readingTime"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Post["fieldData"]["coAuthors"]>().toEqualTypeOf<string[] | undefined>();
  });

  it("types Options as the exact { id, name } pairs, or an unknown option without a name", () => {
    expectTypeOf<NonNullable<Post["fieldData"]["category"]>>().toEqualTypeOf<
      | { id: "c162b2e715b9ea8c4070488a09ab060f"; name: "News" }
      | { id: "9aacbc91fb9dacc1485dd580bef5ad0c"; name: "Guides" }
      | UnknownOption
    >();
    // Rendering code has to handle the missing name.
    expectTypeOf<NonNullable<Post["fieldData"]["category"]>["name"]>().toEqualTypeOf<"News" | "Guides" | undefined>();
  });
});
