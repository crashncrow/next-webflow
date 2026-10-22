import { isElement } from "./dom-node";
// Adapts Webflow's Rich Text markup so it renders correctly without webflow.css. Runs on the DOM tree
// before React, sanitized or not. Webflow's classes (`w-richtext-figure-type-*`, `w-richtext-align-*`)
// are kept so webflow.css or your own styles can still target them.
import type { Element, ChildNode } from "domhandler";
import { isInheritedAlt } from "../core/alt";
import { warnInheritedAlt } from "./dev-warnings";

/** Mutates the tree in place. */
export function prepareWebflowNodes(nodes: ChildNode[], inImageFigure = false): void {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.name === "img") {
      if (isInheritedAlt(node.attribs.alt)) {
        node.attribs.alt = "";
        warnInheritedAlt(
          node.attribs.src ?? "(no src)",
          "select the image in the Rich Text field and set its alt text",
        );
      }
      if (inImageFigure) fitImage(node);
    } else if (node.name === "figure" && node.attribs["data-rt-type"] === "video") {
      sizeVideoFigure(node);
    }
    prepareWebflowNodes(
      node.children,
      inImageFigure || (node.name === "figure" && node.attribs["data-rt-type"] === "image"),
    );
  }
}

/**
 * Webflow writes `width="auto" height="auto"` (not valid values) and relies on webflow.css to fit
 * the image; without it a full-size upload overflows the page. Drop them and cap the width.
 */
function fitImage(img: Element): void {
  img.attribs = Object.fromEntries(
    Object.entries(img.attribs).filter(
      ([name, value]) => !((name === "width" || name === "height") && value === "auto"),
    ),
  );
  img.attribs.style = withStyle(img.attribs.style, "max-width:100%;height:auto");
}

/**
 * Webflow sizes video figures (YouTube, Vimeo, and embeds like tweets through Embedly) with an
 * inline `padding-bottom` computed for its own CSS (centered figures are 60% wide) and expects
 * webflow.css to position the iframe absolutely. Without it you get a gap and a 150px-high iframe.
 * Use `aspect-ratio` from `data-rt-dimensions` ("854:480") instead, and drop the padding (keeping
 * both would make the video twice as tall).
 */
function sizeVideoFigure(figure: Element): void {
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(figure.attribs["data-rt-dimensions"] ?? "");
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!(width > 0 && height > 0)) return;

  figure.attribs.style = withStyle(
    withoutDeclaration(figure.attribs.style, "padding-bottom"),
    `aspect-ratio:${width}/${height}`,
  );
  for (const wrapper of figure.children) {
    if (!isElement(wrapper) || wrapper.name !== "div") continue;
    wrapper.attribs.style = withStyle(wrapper.attribs.style, "height:100%");
    for (const frame of wrapper.children) {
      if (isElement(frame) && frame.name === "iframe") {
        frame.attribs.style = withStyle(frame.attribs.style, "display:block;width:100%;height:100%");
      }
    }
  }
}

const withoutDeclaration = (style: string | undefined, property: string) =>
  (style ?? "")
    .split(";")
    .filter((declaration) => declaration.split(":")[0]?.trim().toLowerCase() !== property)
    .join(";");

const withStyle = (style: string | undefined, extra: string) =>
  [...(style ?? "").split(";"), extra]
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .join(";");
