import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const draft = { isEnabled: false };
vi.mock("next/headers.js", () => ({ draftMode: async () => draft }));
vi.mock("next/navigation.js", () => ({ usePathname: () => "/blog/hello world" }));

const render = async (props: Record<string, unknown> = {}) => {
  const { DraftModeBanner } = await import("../../src/components");
  return renderToStaticMarkup(await DraftModeBanner(props));
};

describe("DraftModeBanner", () => {
  it("renders nothing outside draft mode", async () => {
    draft.isEnabled = false;
    expect(await render()).toBe("");
  });

  it("in draft mode, links to the draft route's exit with the current path (plain <a>, no prefetch)", async () => {
    draft.isEnabled = true;
    const out = await render();
    expect(out).toContain('role="status"');
    expect(out).toContain('<a href="/api/webflow/draft?disable=1&amp;path=%2Fblog%2Fhello%20world" rel="nofollow">Exit preview</a>');
  });

  it("prefixes the base path (option, then NEXT_PUBLIC_BASE_PATH)", async () => {
    draft.isEnabled = true;
    expect(await render({ basePath: "/app/" })).toContain('href="/app/api/webflow/draft?disable=1');
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/spike");
    expect(await render({ route: "/api/preview" })).toContain('href="/spike/api/preview?disable=1');
  });

  it("takes custom content and classes (no inline styles then)", async () => {
    draft.isEnabled = true;
    const out = await render({ children: "Draft", exitLabel: "Leave", className: "banner", exitClassName: "exit" });
    expect(out).toContain('class="banner"');
    expect(out).not.toContain("style=");
    expect(out).toContain('class="exit"');
    expect(out).toContain(">Leave</a>");
  });
});
