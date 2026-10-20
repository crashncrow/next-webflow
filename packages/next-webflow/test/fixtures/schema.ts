import type { WebflowRawItem, WebflowSchema } from "../../src/core";

export const SITE_ID = "site-1";
export const POSTS_ID = "col-posts";
export const AUTHORS_ID = "col-authors";

const CATEGORY_OPTIONS = [
  { id: "opt-news", name: "News" },
  { id: "opt-guides", name: "Guides" },
] as const;

/** Same shape `next-webflow typegen` will emit: every field type is covered. */
export const schema = {
  "blog-posts": {
    id: POSTS_ID,
    slug: "blog-posts",
    fields: {
      name: { slug: "name", type: "PlainText", required: true },
      slug: { slug: "slug", type: "PlainText", required: true },
      postBody: { slug: "post-body", type: "RichText", required: true },
      mainImage: { slug: "main-image", type: "Image", required: false },
      gallery: { slug: "gallery", type: "MultiImage", required: false },
      video: { slug: "video", type: "VideoLink", required: false },
      website: { slug: "website", type: "Link", required: false },
      contactEmail: { slug: "contact-email", type: "Email", required: false },
      phone: { slug: "phone", type: "Phone", required: false },
      readingTime: { slug: "reading-time", type: "Number", required: false },
      publishedOn: { slug: "published-on", type: "DateTime", required: false },
      featured: { slug: "featured", type: "Switch", required: false },
      accentColor: { slug: "accent-color", type: "Color", required: false },
      category: { slug: "category", type: "Option", required: true, options: CATEGORY_OPTIONS },
      attachment: { slug: "attachment", type: "File", required: false },
      author: { slug: "author", type: "Reference", required: false, collectionId: AUTHORS_ID },
      coAuthors: { slug: "co-authors", type: "MultiReference", required: false, collectionId: AUTHORS_ID },
      externalAsset: { slug: "external-asset", type: "ExtFileRef", required: false },
    },
  },
  authors: {
    id: AUTHORS_ID,
    slug: "authors",
    fields: {
      name: { slug: "name", type: "PlainText", required: true },
      slug: { slug: "slug", type: "PlainText", required: true },
    },
  },
} as const satisfies WebflowSchema;

/** `GET /collections/{id}` for the posts collection, as the API returns it. */
export const postsCollectionResponse = {
  id: POSTS_ID,
  displayName: "Blog Posts",
  singularName: "Blog Post",
  slug: "blog-posts",
  fields: [
    { id: "f1", slug: "name", displayName: "Name", type: "PlainText", isRequired: true, isEditable: true, validations: null },
    { id: "f2", slug: "slug", displayName: "Slug", type: "PlainText", isRequired: true, isEditable: true, validations: null },
    { id: "f3", slug: "post-body", displayName: "Post Body", type: "RichText", isRequired: true, isEditable: true },
    {
      id: "f4",
      slug: "category",
      displayName: "Category",
      type: "Option",
      isRequired: true,
      validations: { options: [...CATEGORY_OPTIONS, { id: "opt-tutorials", name: "Tutorials" }] },
    },
    { id: "f5", slug: "author", displayName: "Author", type: "Reference", isRequired: false, metadata: { collectionId: AUTHORS_ID } },
    { id: "f6", slug: "co-authors", displayName: "Co-authors", type: "MultiReference", isRequired: false, validations: { collectionId: AUTHORS_ID } },
    { id: "f7", slug: "subtitle", displayName: "Subtitle", type: "PlainText", isRequired: false },
  ],
};

export const sitesCollectionsResponse = {
  collections: [
    { id: POSTS_ID, displayName: "Blog Posts", singularName: "Blog Post", slug: "blog-posts" },
    { id: AUTHORS_ID, displayName: "Authors", singularName: "Author", slug: "authors" },
  ],
};

export function rawPost(
  overrides: Omit<Partial<WebflowRawItem>, "fieldData"> & { fieldData?: Record<string, unknown> } = {},
): WebflowRawItem {
  const { fieldData, ...rest } = overrides;
  return {
    id: "item-1",
    cmsLocaleId: "locale-1",
    lastPublished: "2026-10-01T10:00:00.000Z",
    lastUpdated: "2026-10-01T09:00:00.000Z",
    createdOn: "2026-09-01T09:00:00.000Z",
    isArchived: false,
    isDraft: false,
    ...rest,
    fieldData: {
      name: "Hello world",
      slug: "hello-world",
      "post-body": "<p>Hi</p>",
      category: "opt-news",
      ...fieldData,
    },
  };
}

/** A post with a value for every field type. */
export const fullRawPost = rawPost({
  fieldData: {
    "main-image": { fileId: "file-1", url: "https://cdn.example/a.jpg", alt: "A" },
    gallery: [
      { fileId: "file-2", url: "https://cdn.example/b.jpg", alt: null },
      { fileId: "file-3", url: "https://cdn.example/c.jpg" },
    ],
    video: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    website: "https://webflow.com",
    "contact-email": "hi@example.com",
    phone: "+15550000000",
    "reading-time": 7,
    "published-on": "2026-10-01T00:00:00.000Z",
    featured: true,
    "accent-color": "#FFFF00",
    category: "opt-guides",
    attachment: { fileId: "file-4", url: "https://cdn.example/d.pdf" },
    author: "author-1",
    "co-authors": ["author-2", "author-3"],
    "external-asset": { anything: true },
  },
});
