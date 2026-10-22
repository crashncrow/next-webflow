import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { WebflowImage, type WebflowImageProps } from "../../src/components";
import postsLive from "../fixtures/api/items-live.json";

vi.mock("next/image.js", () => ({
  // next/image needs the app's image config; the wrapper's job is what it passes to it. Its own
  // props (`fill`, `unoptimized`, `priority`) become data attributes: a plain <img> doesn't take them.
  default: ({ fill, unoptimized, priority, ...props }: Record<string, unknown>) => (
    <img
      data-next-image=""
      data-fill={fill ? "" : undefined}
      data-unoptimized={unoptimized ? "" : undefined}
      data-priority={priority ? "" : undefined}
      {...(props as object)}
    />
  ),
}));

// A real Image field value: every image on the test site has alt: null.
const image = postsLive.items.find((item) => item.fieldData["main-image"])?.fieldData["main-image"] as {
  fileId: string;
  url: string;
  alt: string | null;
};
const render = (props: WebflowImageProps) => renderToStaticMarkup(<WebflowImage {...props} />);

describe("WebflowImage", () => {
  it("passes src and the field's alt to next/image with the given size", () => {
    const out = render({ image: { ...image, alt: "A boat" }, width: 800, height: 600, sizes: "100vw" });
    expect(out).toContain(`src="${image.url}"`);
    expect(out).toContain('alt="A boat"');
    expect(out).toContain('width="800"');
    expect(out).toContain('sizes="100vw"');
  });

  it("treats alt: null as decorative, warning once per image in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = render({ image, fill: true });
    expect(out).toContain('alt=""');
    expect(out).toContain('data-fill=""'); // `fill` reaches next/image
    render({ image, fill: true });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/has no alt text in Webflow/);
  });

  it("passes unoptimized through (Webflow Cloud: skips a srcSet that repeats the original)", () => {
    expect(render({ image: { ...image, alt: "x" }, width: 1, height: 1, unoptimized: true })).toContain('data-unoptimized=""');
  });

  it("never renders Webflow's inherit-alt placeholder (raw items), with a specific warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = render({ image: { ...image, fileId: "inherit", alt: "__wf_reserved_inherit" }, width: 1, height: 1 });
    expect(out).toContain('alt=""');
    expect(out).not.toContain("__wf_reserved_inherit");
    expect(warn.mock.calls[0]?.[0]).toMatch(/inherits its alt text from the Webflow asset.*set it on the image itself/);
  });

  it("doesn't warn when alt is passed explicitly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(render({ image: { ...image, fileId: "other" }, alt: "", width: 1, height: 1 })).toContain('alt=""');
    expect(warn).not.toHaveBeenCalled();
  });

  it("doesn't warn in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render({ image: { ...image, fileId: "prod" }, fill: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it("renders nothing without an image", () => {
    expect(render({ image: null, width: 1, height: 1 })).toBe("");
    expect(render({ image: undefined, fill: true })).toBe("");
  });

  it("requires width and height, or fill (Webflow doesn't report dimensions)", () => {
    expectTypeOf<{ image: typeof image; width: 1; height: 1 }>().toExtend<WebflowImageProps>();
    expectTypeOf<{ image: typeof image; fill: true }>().toExtend<WebflowImageProps>();
    expectTypeOf<{ image: typeof image }>().not.toExtend<WebflowImageProps>();
    expectTypeOf<{ image: typeof image; width: 1 }>().not.toExtend<WebflowImageProps>();
  });
});
