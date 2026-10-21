import type {
  CollectionSchema,
  FieldSchema,
  UnknownFields,
  WebflowItem,
  WebflowRawItem,
  WebflowVideo,
  WebflowVideoMetadata,
} from "./schema";

/** `post-body` → `postBody`, `image-2` → `image2`. Field slugs are lowercase with hyphens. */
export function camelCase(slug: string): string {
  return slug.replace(/[-_\s]+([a-z0-9])/gi, (_, char: string) => char.toUpperCase());
}

/** Why an item couldn't be fully normalized with the given schema (it's probably stale). */
export interface SchemaMismatch {
  unknownFields: string[];
  unknownOptions: Array<{ field: string; id: string }>;
}

export interface NormalizeResult<Fields> {
  item: WebflowItem<Fields>;
  mismatch: SchemaMismatch | undefined;
}

/**
 * Converts a raw API item: camelCase keys, Option IDs → `{ id, name }`, `null` → absent.
 * Fields missing from the schema are kept (camelCased, untouched) and reported in `mismatch`.
 */
export function normalizeItem<Fields = UnknownFields>(
  raw: WebflowRawItem,
  schema: CollectionSchema,
): NormalizeResult<Fields> {
  const fieldData: Record<string, unknown> = {};
  const mismatch: SchemaMismatch = { unknownFields: [], unknownOptions: [] };
  const bySlug = new Map<string, [string, FieldSchema]>(
    Object.entries(schema.fields).map(([key, field]) => [field.slug, [key, field]]),
  );

  for (const [slug, value] of Object.entries(raw.fieldData)) {
    if (value === null || value === undefined) continue;
    const known = bySlug.get(slug);
    if (!known) {
      // `_locale` and similar underscore keys are API metadata, not schema fields.
      if (!slug.startsWith("_")) mismatch.unknownFields.push(slug);
      fieldData[camelCase(slug)] = value;
      continue;
    }

    const [key, field] = known;
    if (field.type === "Option" && typeof value === "string") {
      const option = field.options?.find((candidate) => candidate.id === value);
      if (option) {
        fieldData[key] = { id: option.id, name: option.name };
      } else {
        mismatch.unknownOptions.push({ field: slug, id: value });
        fieldData[key] = { id: value, name: undefined };
      }
    } else if (field.type === "VideoLink") {
      fieldData[key] = normalizeVideo(value);
    } else {
      fieldData[key] = value;
    }
  }

  const item: WebflowItem<Fields> = {
    id: raw.id,
    cmsLocaleId: raw.cmsLocaleId ?? null,
    lastPublished: raw.lastPublished ?? null,
    lastUpdated: raw.lastUpdated,
    createdOn: raw.createdOn,
    isArchived: raw.isArchived,
    isDraft: raw.isDraft,
    fieldData: fieldData as Fields,
  };

  const hasMismatch = mismatch.unknownFields.length > 0 || mismatch.unknownOptions.length > 0;
  return { item, mismatch: hasMismatch ? mismatch : undefined };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `{ url, metadata }` (what the API returns) → `WebflowVideo` with camelCase metadata keys. A plain
 * URL string (the write format) becomes `{ url }`. Anything else is returned untouched.
 */
function normalizeVideo(value: unknown): WebflowVideo | unknown {
  if (typeof value === "string") return { url: value };
  if (!isRecord(value) || typeof value.url !== "string") return value;
  if (!isRecord(value.metadata)) return { url: value.url };

  const metadata: WebflowVideoMetadata = {};
  for (const [key, entry] of Object.entries(value.metadata)) {
    if (entry !== null && entry !== undefined) metadata[camelCase(key)] = entry;
  }
  // The API's aspectRatio isn't reliable (0 for a 1920×1080 video): derive it from the size.
  delete metadata.aspectRatio;
  const { width, height } = metadata;
  if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
    metadata.aspectRatio = width / height;
  }
  return { url: value.url, metadata };
}

interface ApiField {
  id?: string;
  slug?: string;
  type?: string;
  isRequired?: boolean;
  validations?: { options?: Array<{ id: string; name: string }>; collectionId?: string } | null;
  metadata?: { collectionId?: string } | null;
}

export interface ApiCollection {
  id: string;
  slug?: string;
  fields?: ApiField[];
}

/** Converts a `GET /collections/{id}` response into the runtime schema format typegen also emits. */
export function schemaFromApi(collection: ApiCollection): CollectionSchema {
  const fields: Record<string, FieldSchema> = {};
  for (const field of collection.fields ?? []) {
    if (!field.slug || !field.type) continue;
    // The real API puts the referenced collection in `validations` (contract test, 2026-10-20);
    // some docs examples show `metadata`, kept as a fallback.
    const collectionId = field.validations?.collectionId ?? field.metadata?.collectionId;
    fields[camelCase(field.slug)] = {
      slug: field.slug,
      type: field.type as FieldSchema["type"],
      required: field.isRequired ?? false,
      ...(field.validations?.options && { options: field.validations.options }),
      ...(collectionId && { collectionId }),
    };
  }
  return { id: collection.id, slug: collection.slug ?? collection.id, fields };
}
