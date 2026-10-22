import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WebflowRichText, type WebflowComponentProps } from "../../src/components";
import stored from "../fixtures/api/rich-text-stored-probes.json";
import postsLive from "../fixtures/api/items-live.json";
import sample from "../fixtures/api/rich-text-sample.json";

// React 19 hoists a <link rel="preload"> for every <img> when rendering on the server; not ours.
const html = (props: Parameters<typeof WebflowRichText>[0]) =>
  renderToStaticMarkup(<WebflowRichText {...props} />).replace(/<link rel="preload" as="image"[^>]*\/>/g, "");

describe("WebflowRichText", () => {
  it("renders real Rich Text from the test site inside .w-richtext", () => {
    const body = String(postsLive.items[0]?.fieldData.body);
    expect(html({ html: body })).toBe(`<div class="w-richtext">${body}</div>`);
  });

  it("renders nothing for empty values, and supports a custom wrapper or none", () => {
    expect(html({ html: null })).toBe("");
    expect(html({ html: "" })).toBe("");
    expect(html({ html: "<p>x</p>", as: "article", className: "prose" })).toBe(
      '<article class="prose"><p>x</p></article>',
    );
    expect(html({ html: "<p>x</p>", as: null })).toBe("<p>x</p>");
  });

  it("uses next/link for same-site links and plain <a> for the rest", () => {
    const out = html({
      html: '<p><a href="/blog/x" title="t">in</a> <a href="https://example.com">out</a> <a href="//evil.com">pr</a></p>',
    });
    expect(out).toContain('<a title="t" href="/blog/x">in</a>');
    expect(out).toContain('<a href="https://example.com">out</a>');
    expect(out).toContain('<a href="//evil.com">pr</a>');
  });

  it("replaces elements by tag with `components`", () => {
    const Quote = ({ children, cite }: { children?: React.ReactNode; cite?: unknown }) => (
      <figure data-cite={String(cite)}>{children}</figure>
    );
    expect(
      html({ html: '<blockquote cite="/s">Q <strong>x</strong></blockquote>', components: { blockquote: Quote } }),
    ).toBe('<div class="w-richtext"><figure data-cite="/s">Q <strong>x</strong></figure></div>');
  });

  // A real post written in Webflow's editor (staged): links, images with and without alt, a caption,
  // a YouTube video, a tweet (stored as an Embedly video), a code block, quote, H3 and list.
  describe("real editor content", () => {
    const body = sample.fieldData.body;

    // First render of the sample: development warnings are once per image for the whole process.
    it("renders images that inherit the asset's alt as decorative, never the placeholder", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const out = html({ html: body });
      expect(out).not.toContain("__wf_reserved_inherit");
      expect(out).toMatch(/<img alt="" src="[^"]+sayan-nath[^"]+"/);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(/inherits its alt text from the Webflow asset.*set its alt text/);
    });

    it("keeps links, captions, quotes and lists as Webflow wrote them", () => {
      const out = html({ html: body });
      expect(out).toContain('<a href="/post/cms-future-10">dummy</a>');
      expect(out).toContain('<a href="https://google.com" target="_blank">Lorem Ipsum</a>');
      expect(out).toContain('<img alt="A desert next to the sea (alt)"');
      expect(out).not.toContain('width="auto"');
      expect(out.match(/<img [^>]*style="max-width:100%;height:auto"/g)).toHaveLength(2);
      expect(out).toContain("<figcaption>A desert next to the sea (under)</figcaption>");
      expect(out).toContain("<blockquote>Beware of the assumption");
      expect(out).toContain("<ol><li>Node</li>");
    });

    it("sizes video figures with aspect-ratio instead of Webflow's padding, keeping its classes", () => {
      const out = html({ html: body });
      expect(out).not.toContain("padding-bottom");
      expect(out).toContain(
        '<figure class="w-richtext-figure-type-video w-richtext-align-center" style="aspect-ratio:854/480" data-rt-type="video"',
      );
      expect(out).toContain(
        '<figure class="w-richtext-figure-type-video w-richtext-align-center" style="aspect-ratio:500/281"',
      );
      expect(out).toContain('<div style="height:100%"><iframe src="https://www.youtube.com/embed/3mC_QUbGCUw"');
      expect(out).toContain('src="//cdn.embedly.com/widgets/media.html?');
      expect(out.match(/style="display:block;width:100%;height:100%"/g)).toHaveLength(2);
    });

    it("leaves figures without valid dimensions alone, and keeps other inline styles", () => {
      expect(html({ html: '<figure data-rt-type="video" style="padding-bottom:50%"><div></div></figure>' })).toContain(
        'style="padding-bottom:50%"',
      );
      expect(
        html({
          html: '<figure data-rt-type="video" data-rt-dimensions="16:9" style="padding-bottom:50%;max-width:600px"><div></div></figure>',
        }),
      ).toContain('style="max-width:600px;aspect-ratio:16/9"');
    });

    it("gives a figure override the adjusted style and Webflow's classes", () => {
      const Figure = ({
        className,
        style,
        children,
      }: {
        className?: string;
        style?: object;
        children?: React.ReactNode;
      }) => (
        <section data-class={className} data-style={JSON.stringify(style)}>
          {children}
        </section>
      );
      const out = html({ html: body, components: { figure: Figure as never } });
      expect(out).toContain(
        'data-class="w-richtext-figure-type-video w-richtext-align-center" data-style="{&quot;aspectRatio&quot;:&quot;854/480&quot;}"',
      );
    });
  });

  describe("Webflow components (<wf-component>)", () => {
    const callout = `<wf-component data-w-id="w1" component-id="c1" name="Callout" prop-2c00="Heads up"><wf-prop name="18e1" label="Body" type="richtext"><p>Bring your towel.</p></wf-prop></wf-component>`;

    it("renders them by name with scalar props, rendered slots and slot labels", () => {
      const Callout = ({ props, slots, slotIds, componentId }: WebflowComponentProps) => (
        <aside data-id={componentId} data-title={props["2c00"]}>
          {slots[slotIds.Body ?? ""]}
        </aside>
      );
      expect(html({ html: callout, webflowComponents: { Callout } })).toBe(
        '<div class="w-richtext"><aside data-id="c1" data-title="Heads up"><p>Bring your towel.</p></aside></div>',
      );
    });

    it("falls back to the text content and warns once in development", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(html({ html: callout + callout })).toBe(
        '<div class="w-richtext"><div data-wf-component="Callout"><p>Bring your towel.</p></div><div data-wf-component="Callout"><p>Bring your towel.</p></div></div>',
      );
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatch(/webflowComponents=\{\{ "Callout": MyComponent \}\}/);
    });
  });

  describe("sanitizing Rich Text read back from the API (real round trip)", () => {
    const rendered = (key: keyof typeof stored) => html({ html: stored[key] });

    it.each([
      ["script", "<p>a</p>"],
      ["onclick", "<p>b</p>"],
      ["jsHref", "<p><a>c</a></p>"],
      ["dataHref", "<p><a>d</a></p>"],
      ["iframeSrcdoc", "<iframe></iframe>"],
      ["iframeJsSrc", "<iframe></iframe>"],
      ["objectEmbed", ""],
      ["imgOnerror", '<p><img src="x"/></p>'],
      ["form", "<form><button>e</button></form>"],
      ["svg", "<svg><a>f</a></svg>"],
      ["styleUrl", "<p>g</p>"],
      ["embedDiv", '<div class="w-embed"></div>'],
      ["mixedCaseJs", "<p><a>h</a></p>"],
    ] as const)("%s", (key, expected) => {
      expect(rendered(key)).toBe(`<div class="w-richtext">${expected}</div>`);
    });

    it.each([
      ["entity-encoded colon", '<a href="javascript&#58;alert(1)">x</a>', "<a>x</a>"],
      ["tab inside the scheme", '<a href="java\tscript:alert(1)">x</a>', "<a>x</a>"],
      ["vbscript", '<a href="vbscript:msgbox(1)">x</a>', "<a>x</a>"],
      ["data: image src", '<img src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;"/>', "<img/>"],
      ["srcset entry", '<img src="/a.jpg" srcset="/a.jpg 1x, javascript:alert(1) 2x"/>', '<img src="/a.jpg"/>'],
      [
        "SVG animate to javascript:",
        '<svg><animate attributeName="href" values="0;javascript:alert(1)"></animate></svg>',
        '<svg><animate attributeName="href"></animate></svg>',
      ],
      ["meta refresh", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)"/><p>x</p>', "<p>x</p>"],
      ["base href", '<base href="https://evil.com/"/><p>x</p>', "<p>x</p>"],
      ["style expression", '<p style="width:expression(alert(1))">x</p>', "<p>x</p>"],
      ["upper-case handler", '<p ONMOUSEOVER="alert(1)">x</p>', "<p>x</p>"],
    ])("%s", (_, input, expected) => {
      expect(html({ html: input })).toBe(`<div class="w-richtext">${expected}</div>`);
    });

    it("keeps safe embeds: iframes with https src, styles, data attributes", () => {
      const embed =
        '<div class="w-embed"><iframe src="https://player.vimeo.com/video/1" allowfullscreen=""></iframe></div><p style="color:red" data-x="1">y</p>';
      expect(html({ html: embed })).toBe(
        '<div class="w-richtext"><div class="w-embed"><iframe src="https://player.vimeo.com/video/1" allowFullScreen=""></iframe></div><p style="color:red" data-x="1">y</p></div>',
      );
    });

    it("keeps everything with allowScripts (explicit opt-in)", () => {
      const out = html({
        html: stored.script + stored.jsHref + stored.iframeSrcdoc + stored.objectEmbed,
        allowScripts: true,
      });
      expect(out).toContain("<script>alert(1)</script>");
      // React 19 itself neutralizes javascript: URLs in href, even when we keep them.
      expect(out).toContain("React has blocked a javascript: URL");
      expect(out).toContain("srcDoc=");
      expect(out).toContain("<object");
    });
  });
});
