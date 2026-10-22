import type { ChildNode, Element } from "domhandler";

/** Structural check: parsed nodes may come from another copy of domhandler. */
export function isElement(node: ChildNode): node is Element {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}
