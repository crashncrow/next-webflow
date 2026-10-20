import type { CollectionSchema, FieldSchema, UnknownFields, WebflowItem, WebflowRawItem } from "./schema";

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
        fieldData[key] = { id: value, name: value };
      }
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
    // Docs show the referenced collection both under `validations` and `metadata`.
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
