/**
 * Fixtures built from REAL responses of the test site (`test/fixtures/api/*.json`, copied from the
 * contract test output with `pnpm fixtures:update`). Only `schema` is hand-written, because types
 * need its literals; a test checks it matches `schemaFromApi(realPostsCollection)`.
 */
import type { WebflowRawItem, WebflowSchema } from "../../src/core";
import type { ApiCollection } from "../../src/core/normalize";
import collectionJson from "./api/collection.json";
import itemsLiveJson from "./api/items-live.json";
import itemsStagedJson from "./api/items-staged.json";
import siteCollectionsJson from "./api/site-collections.json";

/** Only a URL parameter in tests; the real site ID never matters to them. */
export const SITE_ID = "site-1";

export const POSTS_ID = "6ad82366355bfa1700d50617";
export const AUTHORS_ID = "6ad821e72fa557039fdc30e2";

const NEWS = { id: "c162b2e715b9ea8c4070488a09ab060f", name: "News" } as const;
const GUIDES = { id: "9aacbc91fb9dacc1485dd580bef5ad0c", name: "Guides" } as const;
export const OPTIONS = { news: NEWS, guides: GUIDES };

/** What `next-webflow typegen` emits for the test site. Covers every field type but ExtFileRef. */
export const schema = {
  posts: {
    id: POSTS_ID,
    slug: "posts",
    fields: {
      body: { slug: "body", type: "RichText", required: true },
      mainImage: { slug: "main-image", type: "Image", required: false },
      gallery: { slug: "gallery", type: "MultiImage", required: false },
      video: { slug: "video", type: "VideoLink", required: false },
      website: { slug: "website", type: "Link", required: false },
      contactEmail: { slug: "contact-email", type: "Email", required: false },
      phone: { slug: "phone", type: "Phone", required: false },
      readingTime: { slug: "reading-time", type: "Number", required: false },
      publishDate: { slug: "publish-date", type: "DateTime", required: false },
      featured: { slug: "featured", type: "Switch", required: false },
      accentColor: { slug: "accent-color", type: "Color", required: false },
      attachment: { slug: "attachment", type: "File", required: false },
      category: { slug: "category", type: "Option", required: false, options: [NEWS, GUIDES] },
      author: { slug: "author", type: "Reference", required: false, collectionId: AUTHORS_ID },
      coAuthors: { slug: "co-authors", type: "MultiReference", required: false, collectionId: AUTHORS_ID },
      name: { slug: "name", type: "PlainText", required: true },
      slug: { slug: "slug", type: "PlainText", required: true },
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

/** `GET /sites/{siteId}/collections`, real. */
export const sitesCollectionsResponse = siteCollectionsJson;

interface ApiFieldJson {
  id: string;
  slug: string;
  displayName: string;
  type: string;
  isRequired: boolean;
  validations?: { options?: Array<{ id: string; name: string }>; [key: string]: unknown } | null;
  [key: string]: unknown;
}

/** `GET /collections/{postsId}`, real. */
export const realPostsCollection = collectionJson as unknown as ApiCollection & {
  id: string;
  slug: string;
  fields: ApiFieldJson[];
  [key: string]: unknown;
};

/** A Webflow-like Option ID for an option that doesn't exist on the test site (yet). */
export const TUTORIALS_ID = "5f0d3c8e2b7a4e61a9c4d1b0e7f2a3c4";

/**
 * The real posts collection after an editor changed it post-typegen: a new `Tutorials` option and
 * a new `subtitle` field. Used to test the stale-schema fallback.
 */
export const postsCollectionResponse = {
  ...realPostsCollection,
  fields: [
    ...realPostsCollection.fields.map((field) =>
      field.slug === "category"
        ? {
            ...field,
            validations: { options: [...(field.validations?.options ?? []), { id: TUTORIALS_ID, name: "Tutorials" }] },
          }
        : field,
    ),
    {
      id: "0e5b7f3c9a2d4c1e8b6f0a7d3e9c2b51",
      slug: "subtitle",
      displayName: "Subtitle",
      type: "PlainText",
      isRequired: false,
      isEditable: true,
      helpText: null,
      validations: null,
    },
  ],
};

/** `GET /collections/{postsId}/items/live` and `/items`, real (9 live, 10 staged incl. a draft). */
export const liveItems = itemsLiveJson.items as unknown as WebflowRawItem[];
export const stagedItems = itemsStagedJson.items as unknown as WebflowRawItem[];

function liveItem(slug: string): WebflowRawItem {
  const item = liveItems.find((candidate) => candidate.fieldData.slug === slug);
  if (!item) throw new Error(`No live fixture item with slug "${slug}"`);
  return item;
}

/** A live post with a value in every field. */
export const fullRawPost = liveItem("cms-future-10");
/** A live post whose empty fields (image, video, date, option, references…) come back as `null`. */
export const sparseRawPost = liveItem("cms-user-training-8");
/** Staged only: never published, so the live endpoints 404. */
export const draftRawPost = stagedItems.find((item) => item.isDraft) as WebflowRawItem;

/** A real live post with overrides (merged into `fieldData`). Defaults to `fullRawPost`. */
export function rawPost(
  overrides: Omit<Partial<WebflowRawItem>, "fieldData"> & { fieldData?: Record<string, unknown> } = {},
): WebflowRawItem {
  const { fieldData, ...rest } = overrides;
  const base = structuredClone(fullRawPost);
  return { ...base, ...rest, fieldData: { ...base.fieldData, ...fieldData } };
}
