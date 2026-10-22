import { expect, it } from "vitest";
import { createPreviewUrl, verifyPreviewParams } from "../../src/core";
import { DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS } from "../../src/core/preview";

it("accepts the maximum preview lifetime and rejects one second over", async () => {
  const options = { url: "https://example.com/draft", collection: "posts", itemId: "item", secret: "secret", now: 0 };
  const url = await createPreviewUrl({ ...options, expiresIn: DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS });
  await expect(verifyPreviewParams(new URL(url).searchParams, { secrets: ["secret"], now: 0 })).resolves.toMatchObject({
    ok: true,
  });
  await expect(createPreviewUrl({ ...options, expiresIn: DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS + 1 })).rejects.toThrow(
    /2592000.*30 days.*maxLifetimeSeconds/,
  );
});
