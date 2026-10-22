import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ChildNode, Element } from "domhandler";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import ts from "typescript";
import htmlToDOM from "html-dom-parser/lib/server/html-to-dom";
import { WebflowRichText } from "../../src/components";
import { sanitizeNodes } from "../../src/components/sanitize";

// Simulate independently installed domhandler classes before our sanitizer sees the tree.
vi.mock("html-dom-parser/lib/server/html-to-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("html-dom-parser/lib/server/html-to-dom")>();
  class ForeignNode {
    foreign = true;
  }
  const detach = (nodes: ChildNode[]) => {
    for (const node of nodes) {
      Object.setPrototypeOf(node, ForeignNode.prototype);
      if ("children" in node) detach(node.children);
    }
    return nodes;
  };
  return { default: (html: string) => detach(original.default(html) as ChildNode[]) };
});

const unsafe =
  '<script>bad()</script><object>x</object><embed src="x"><meta http-equiv="refresh"><base href="https://evil.com"><p onclick="bad()"><a href="javascript:bad()">safe</a><iframe srcdoc="bad"></iframe></p>';

it("sanitizes nodes from foreign classes by their type", () => {
  const nodes = sanitizeNodes(htmlToDOM(unsafe) as ChildNode[]);
  expect(nodes).toHaveLength(1);
  const paragraph = nodes[0] as Element;
  expect(paragraph.name).toBe("p");
  expect(paragraph.attribs).toEqual({});
  expect((paragraph.children[0] as Element).attribs).toEqual({});
  expect((paragraph.children[1] as Element).attribs).toEqual({});
});

it("renders sanitized foreign nodes, figures, overrides and component slots", () => {
  const output = renderToStaticMarkup(
    <WebflowRichText
      html={
        unsafe +
        '<figure data-rt-type="image"><img src="/pic.jpg" alt="pic" width="auto" height="auto"></figure><figure data-rt-type="video" data-rt-dimensions="16:9"><div><iframe src="https://example.com"></iframe></div></figure><wf-component name="Card"><wf-prop name="body"><b>slot</b></wf-prop></wf-component>'
      }
      components={{ p: ({ children }) => <section>{children}</section> }}
      webflowComponents={{ Card: ({ slots }) => <aside>{slots.body}</aside> }}
    />,
  );
  expect(output).toContain("<section><a>safe</a><iframe></iframe></section>");
  expect(output).toContain("max-width:100%;height:auto");
  expect(output).toContain("aspect-ratio:16/9");
  expect(output).toContain("display:block;width:100%;height:100%");
  expect(output).toContain("<aside><b>slot</b></aside>");
  expect(output).not.toMatch(/<script|<object|<embed|<meta|<base|onclick|javascript:|srcdoc|width="auto"/);
});

it("never uses domhandler class identity anywhere in src", () => {
  const root = fileURLToPath(new URL("../../src/", import.meta.url));
  const violations: string[] = [];
  const domClasses = new Set([
    "Element",
    "Text",
    "Node",
    "NodeWithChildren",
    "DataNode",
    "Comment",
    "Document",
    "ProcessingInstruction",
  ]);
  for (const path of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (!/\.tsx?$/.test(path)) continue;
    const source = ts.createSourceFile(path, readFileSync(`${root}/${path}`, "utf8"), ts.ScriptTarget.Latest, true);
    const names = new Set(domClasses);
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "domhandler"
      )
        continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const binding of bindings.elements) names.add(binding.name.text);
    }
    const visit = (node: ts.Node) => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
        const name = ts.isPropertyAccessExpression(node.right) ? node.right.name.text : node.right.getText(source);
        if (names.has(name)) violations.push(`${path}: ${node.getText(source)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(violations).toEqual([]);
});
