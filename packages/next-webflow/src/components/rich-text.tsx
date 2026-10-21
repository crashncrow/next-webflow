// Renders Webflow Rich Text as React elements. Works as a Server Component (no "use client"),
// so the parser never reaches the browser bundle.
import { Element, type ChildNode } from "domhandler";
// The server parser explicitly: html-dom-parser's `browser` export uses DOMParser, and Cloudflare
// Workers resolve the `browser` condition but have no DOM.
import htmlToDOM from "html-dom-parser/lib/server/html-to-dom";
import { attributesToProps, domToReact, type DOMNode, type HTMLReactParserOptions } from "html-react-parser";
import Link from "next/link.js";
import { Fragment, type ComponentType, type JSX, type ReactNode } from "react";
import { warnOnceInDev } from "./dev-warnings";
import { sanitizeNodes } from "./sanitize";
import { prepareWebflowNodes } from "./webflow-html";

/** Props an element override receives: the element's attributes as React props, its children, and the parsed node. */
export type RichTextElementProps = Record<string, unknown> & { children?: ReactNode; node: Element };

/** A Webflow component instance (`<wf-component>`) found in the Rich Text. */
export interface WebflowComponentProps {
  /** The component's display name (`name` attribute), e.g. `"Callout"`. */
  name: string;
  /** `component-id`: the component definition. */
  componentId: string | undefined;
  /** Scalar properties (`prop-<id>="…"`), keyed by property ID. */
  props: Record<string, string>;
  /** Text / rich text properties (`<wf-prop>`), rendered, keyed by property ID. */
  slots: Record<string, ReactNode>;
  /** `<wf-prop label>` → property ID, so you can look slots up by label. */
  slotIds: Record<string, string>;
  node: Element;
}

export interface WebflowRichTextProps {
  /** The Rich Text field value (HTML). Empty renders nothing. */
  html: string | null | undefined;
  /** Replace elements by tag name, e.g. `{ blockquote: MyQuote, img: MyImage }`. */
  components?: Partial<Record<string, ComponentType<RichTextElementProps>>> | undefined;
  /** Render Webflow component instances (`<wf-component name="…">`) by name. */
  webflowComponents?: Partial<Record<string, ComponentType<WebflowComponentProps>>> | undefined;
  /**
   * INSECURE: keep `<script>`, `<object>`, `<embed>`, `on*` handlers, `srcdoc` and
   * `javascript:` / `data:` URLs. Prefer replacing script-based embeds with components.
   */
  allowScripts?: boolean | undefined;
  /** Wrapper element (default `div`); `null` renders the content without a wrapper. */
  as?: keyof JSX.IntrinsicElements | null | undefined;
  /** Class of the wrapper. Default `"w-richtext"` (Webflow's own Rich Text class). */
  className?: string | undefined;
}

/** Same-site paths (not protocol-relative) go through `next/link`. */
const isInternalHref = (href: unknown): href is string =>
  typeof href === "string" && href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\");

export function WebflowRichText({
  html,
  components = {},
  webflowComponents = {},
  allowScripts = false,
  as: Wrapper = "div",
  className = "w-richtext",
}: WebflowRichTextProps): ReactNode {
  if (!html) return null;
  const nodes = sanitizeNodes(htmlToDOM(html) as ChildNode[], { allowScripts });
  prepareWebflowNodes(nodes);

  const options: HTMLReactParserOptions = {
    replace(domNode) {
      if (!(domNode instanceof Element)) return undefined;
      const children = () => domToReact(domNode.children as DOMNode[], options);
      const tag = domNode.name;

      if (tag === "wf-component") return renderWebflowComponent(domNode, children, options, webflowComponents);

      const Override = components[tag];
      if (Override) {
        return <Override {...attributesToProps(domNode.attribs, tag)} node={domNode}>{children()}</Override>;
      }
      if (tag === "a" && isInternalHref(domNode.attribs.href)) {
        const { href, ...rest } = attributesToProps(domNode.attribs, tag) as Record<string, unknown> & { href: string };
        return (
          <Link href={href} {...rest}>
            {children()}
          </Link>
        );
      }
      return undefined;
    },
  };

  const content = domToReact(nodes as DOMNode[], options);
  if (Wrapper === null) return <>{content}</>;
  return <Wrapper className={className}>{content}</Wrapper>;
}

function renderWebflowComponent(
  element: Element,
  children: () => ReturnType<typeof domToReact>,
  options: HTMLReactParserOptions,
  webflowComponents: Partial<Record<string, ComponentType<WebflowComponentProps>>>,
): JSX.Element {
  const name = element.attribs.name ?? "";
  const props: Record<string, string> = {};
  for (const [attribute, value] of Object.entries(element.attribs)) {
    if (attribute.startsWith("prop-")) props[attribute.slice("prop-".length)] = value;
  }
  const slots: Record<string, ReactNode> = {};
  const slotIds: Record<string, string> = {};
  for (const child of element.children) {
    if (child instanceof Element && child.name === "wf-prop" && child.attribs.name) {
      slots[child.attribs.name] = domToReact(child.children as DOMNode[], options);
      if (child.attribs.label) slotIds[child.attribs.label] = child.attribs.name;
    }
  }
  const Component = webflowComponents[name];
  if (Component) {
    return <Component name={name} componentId={element.attribs["component-id"]} props={props} slots={slots} slotIds={slotIds} node={element} />;
  }
  warnOnceInDev(
    `component:${name}`,
    `Rich Text contains the Webflow component "${name}" with no React component for it; rendering its text content. ` +
      `Pass webflowComponents={{ "${name}": MyComponent }} to <WebflowRichText>.`,
  );
  const rendered = Object.entries(slots);
  return (
    <div data-wf-component={name}>
      {rendered.length ? rendered.map(([id, slot]) => <Fragment key={id}>{slot}</Fragment>) : children()}
    </div>
  );
}
