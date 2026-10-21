import { createWebflow, type WebflowSchema } from "next-webflow";
import { schema } from "@/webflow-schema";

export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  const { slug } = await searchParams;
  const warnings: string[] = [];
  // A fresh instance per request so the warnings of this render can be shown on the page.
  const cms = createWebflow({
    schema: schema as WebflowSchema,
    logger: { warn: (message: string) => warnings.push(message) },
  });

  let content: unknown;
  try {
    content = slug ? await cms.getItemBySlug("posts", slug) : await cms.getItems("posts");
  } catch (error) {
    content = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }

  return (
    <main>
      <h1>Library: {slug ? `getItemBySlug("posts", "${slug}")` : `getItems("posts")`}</h1>
      <p>Generated schema collections: {Object.keys(schema).join(", ") || "(none: API fallback)"}</p>
      <h2>Warnings</h2>
      <pre>{warnings.length > 0 ? warnings.join("\n\n") : "(none)"}</pre>
      <h2>Result</h2>
      <pre>{JSON.stringify(content, null, 2)}</pre>
    </main>
  );
}
