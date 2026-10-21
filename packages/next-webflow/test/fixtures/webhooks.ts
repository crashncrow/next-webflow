/**
 * Webhook bodies. `real` are REAL payloads captured from the test site in the stage 4 end-to-end
 * test (`test/fixtures/api/webhooks/*.json`, `site_publish.publishedBy` anonymized). Findings:
 * flags are `isArchived`/`isDraft`; `collection_item_published` wraps items in `items`, every other
 * item event is a flat item; `isDraft` is `true` only while an item has unpublished (staged) changes.
 * Bodies not captured (several published items, `collection_item_created`, the docs' `archived`/
 * `draft` spelling) are built from the real ones and marked SYNTHETIC.
 */
import changedLiveApi from "./api/webhooks/changed-live-api.json";
import changedOnPublish from "./api/webhooks/changed-on-publish.json";
import changedStaged from "./api/webhooks/changed-staged.json";
import deleted from "./api/webhooks/deleted.json";
import published from "./api/webhooks/published.json";
import sitePublish from "./api/webhooks/site-publish.json";
import unpublished from "./api/webhooks/unpublished.json";
import { AUTHORS_ID, POSTS_ID } from "./schema";

export const SITE = "6ad820fdc7a6d0801b96394e";

export const real = {
  /** Name edited and saved in the CMS, not published. */
  changedStaged,
  /** Fired together with `collection_item_published` by "Publish now". */
  changedOnPublish,
  /** `PATCH /collections/{id}/items/live`: the only event an API live edit fires. */
  changedLiveApi,
  /** "Publish now" on one item. */
  published,
  unpublished,
  /** Deleting a published item. */
  deleted,
  sitePublish,
};

type ItemPayload = Omit<typeof changedLiveApi.payload, "isDraft" | "isArchived"> & Record<string, unknown>;

/** SYNTHETIC: a real item payload with another ID/slug/collection, and optionally the docs' `archived`/`draft` spelling. */
export function itemPayload(id: string, slug: string, collectionId = POSTS_ID, flags: "is" | "plain" = "is"): ItemPayload {
  const { isArchived, isDraft, ...rest } = changedLiveApi.payload;
  return {
    ...rest,
    id,
    collectionId,
    ...(flags === "is" ? { isArchived, isDraft } : { archived: isArchived, draft: isDraft }),
    fieldData: { ...rest.fieldData, name: slug, slug },
  };
}

export const IDS = {
  /** cms-trends-2023-5: staged edit, publish, API live edit. */
  POST_A: changedLiveApi.payload.id,
  POST_B: "6ad82459d716cd2a5aa2196f",
  AUTHOR: "6ad823ee45bfdd80dc4a732a",
  UNPUBLISHED: unpublished.payload.id,
  DELETED: deleted.payload.id,
};

export const webhookBodies = {
  // SYNTHETIC: not captured; shaped like a staged edit.
  collection_item_created: { triggerType: "collection_item_created", payload: changedStaged.payload },
  collection_item_changed: real.changedStaged,
  collection_item_deleted: real.deleted,
  collection_item_unpublished: real.unpublished,
  // SYNTHETIC: three items (the capture had one), one from another collection.
  collection_item_published: {
    triggerType: "collection_item_published",
    payload: {
      items: [
        published.payload.items[0],
        itemPayload(IDS.POST_B, "cms-future-10"),
        itemPayload(IDS.AUTHOR, "ada-lovelace", AUTHORS_ID),
      ],
    },
  },
  site_publish: real.sitePublish,
};
