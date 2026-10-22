// The contract test's drift detection (test/contract/shape.ts), checked without the real API.
import { describe, expect, it } from "vitest";
import { diffItemShapes, driftLines } from "./contract/shape";
import { fullRawPost } from "./fixtures/schema";

const clone = <T>(value: T): T => structuredClone(value);

describe("contract drift detection", () => {
  it("ignores empty fields and which item holds a value", () => {
    const empty = {
      ...clone(fullRawPost),
      id: "other",
      fieldData: Object.fromEntries(Object.keys(fullRawPost.fieldData).map((key) => [key, null])),
    };
    expect(driftLines({ live: diffItemShapes(fullRawPost, [empty, clone(fullRawPost)]) })).toEqual([]);
  });

  it("reports removed keys and changed types as readable lines; new keys are informational", () => {
    const real = clone(fullRawPost) as unknown as Record<string, unknown> & { fieldData: Record<string, unknown> };
    delete real.isDraft;
    real.fieldData.video = "https://vimeo.com/1";
    real.fieldData["new-field"] = "x";
    expect(driftLines({ live: diffItemShapes(fullRawPost, [real]) })).toEqual([
      "live: $.isDraft is gone (fixture: boolean)",
      "live: $.fieldData.video changed type: fixture object, real string",
    ]);
  });
});
