/** A structural description of a JSON value: types and keys, not values. */
export type Shape =
  | { kind: "null" | "string" | "number" | "boolean" | "undefined" }
  | { kind: "array"; items: Shape[] }
  | { kind: "object"; keys: Record<string, Shape> };

export function shapeOf(value: unknown): Shape {
  if (value === null) return { kind: "null" };
  if (Array.isArray(value)) return { kind: "array", items: dedupe(value.map(shapeOf)) };
  if (typeof value === "object") {
    return {
      kind: "object",
      keys: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shapeOf(entry)])),
    };
  }
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean" || kind === "undefined") return { kind };
  return { kind: "undefined" };
}

export interface ShapeDifference {
  path: string;
  /** `missing`: in the fixture, not in the real response. `extra`: the other way round. */
  type: "missing" | "extra" | "type";
  fixture?: string | undefined;
  real?: string | undefined;
}

/**
 * Compares a fixture with a real response. Arrays are compared through their first element. `null`
 * on either side says nothing about the shape (an empty field, an unpublished date), so it's skipped.
 */
export function diffShapes(fixture: unknown, real: unknown, path = "$"): ShapeDifference[] {
  const a = shapeOf(fixture);
  const b = shapeOf(real);
  if (a.kind === "null" || b.kind === "null") return [];
  if (a.kind !== b.kind) return [{ path, type: "type", fixture: a.kind, real: b.kind }];

  if (a.kind === "object" && b.kind === "object") {
    const fixtureObject = fixture as Record<string, unknown>;
    const realObject = real as Record<string, unknown>;
    const differences: ShapeDifference[] = [];
    for (const key of Object.keys(a.keys)) {
      if (!(key in b.keys)) differences.push({ path: `${path}.${key}`, type: "missing", fixture: a.keys[key]?.kind });
      else differences.push(...diffShapes(fixtureObject[key], realObject[key], `${path}.${key}`));
    }
    for (const key of Object.keys(b.keys)) {
      if (!(key in a.keys)) differences.push({ path: `${path}.${key}`, type: "extra", real: b.keys[key]?.kind });
    }
    return differences;
  }

  if (a.kind === "array" && b.kind === "array") {
    const [first] = fixture as unknown[];
    const [realFirst] = real as unknown[];
    if (first === undefined || realFirst === undefined) return [];
    return diffShapes(first, realFirst, `${path}[0]`);
  }

  return [];
}

function dedupe(shapes: Shape[]): Shape[] {
  const seen = new Map<string, Shape>();
  for (const shape of shapes) seen.set(JSON.stringify(shape), shape);
  return [...seen.values()];
}

type ItemLike = { id?: unknown; fieldData?: Record<string, unknown> };

/**
 * Compares a fixture item with real items: top-level keys against the real item with the same ID
 * (or the first one), and each field's value against the first real item where it isn't empty, so
 * which items happen to have values doesn't matter.
 */
export function diffItemShapes(fixture: ItemLike, realItems: readonly ItemLike[]): ShapeDifference[] {
  const match = realItems.find((item) => item.id === fixture.id) ?? realItems[0];
  if (!match) return [{ path: "$", type: "missing", fixture: "item" }];
  const { fieldData: fixtureFields = {}, ...fixtureTop } = fixture;
  const { fieldData: realFields = {}, ...realTop } = match;
  const differences = diffShapes(fixtureTop, realTop);
  for (const [slug, value] of Object.entries(fixtureFields)) {
    if (!(slug in realFields)) {
      differences.push({ path: `$.fieldData.${slug}`, type: "missing", fixture: shapeOf(value).kind });
      continue;
    }
    const withValue = realItems.find((item) => item.fieldData?.[slug] != null)?.fieldData?.[slug];
    differences.push(...diffShapes(value, withValue ?? null, `$.fieldData.${slug}`));
  }
  for (const slug of Object.keys(realFields)) {
    if (!(slug in fixtureFields))
      differences.push({ path: `$.fieldData.${slug}`, type: "extra", real: shapeOf(realFields[slug]).kind });
  }
  return differences;
}

/** Breaking differences (a key we read is gone or changed type), as readable lines. */
export function driftLines(diffs: Record<string, ShapeDifference[]>): string[] {
  return Object.entries(diffs).flatMap(([name, list]) =>
    list
      .filter((difference) => difference.type !== "extra")
      .map((difference) =>
        difference.type === "missing"
          ? `${name}: ${difference.path} is gone (fixture: ${difference.fixture})`
          : `${name}: ${difference.path} changed type: fixture ${difference.fixture}, real ${difference.real}`,
      ),
  );
}
