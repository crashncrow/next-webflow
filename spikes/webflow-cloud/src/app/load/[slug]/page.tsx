import { notFound } from "next/navigation";
import { createWebflow, WebflowNotFoundError } from "next-webflow";
import { createMeasuredFetch } from "@/lib/measured-fetch";
import { schema } from "@/webflow/schema";

// Spike only (stage 5b): a page per load-test item, prerendered with generateStaticParams.
// `LOAD_SOURCE=cdn` switches the source at build time. Every Webflow request is logged to the build output.
// Webflow Cloud builds locally without the app's env vars: export WEBFLOW_CMS_TOKEN in the deploy
// shell (it doesn't clash with the Webflow CLI, which reads WEBFLOW_API_TOKEN).
const measured = createMeasuredFetch({
  log: (record) =>
    console.log(`[measure] ${new Date().toISOString()} ${record.status} ${record.ms}ms ${record.bytes}B rl=${record.rateLimitRemaining} cdn=${record.cdnCache} ${record.path}`),
});
const cms = createWebflow({
  schema,
  source: process.env.LOAD_SOURCE === "cdn" ? "cdn" : "data",
  fetch: measured.fetch,
});

export async function generateStaticParams() {
  const started = Date.now();
  // A collection that was never published answers 404 on /items/live (not an empty list).
  const items = await cms.getItems("load-test").catch((error: unknown) => {
    if (error instanceof WebflowNotFoundError) return [];
    throw error;
  });
  console.log(`[measure] generateStaticParams: ${items.length} items in ${Date.now() - started}ms`);
  return items.map((item) => ({ slug: item.fieldData.slug }));
}

export default async function LoadItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = await cms.getItemBySlug("load-test", slug);
  if (!item) notFound();
  return (
    <main>
      <h1>{item.fieldData.name}</h1>
      <p>
        Rank {item.fieldData.rank} · {item.fieldData.tier?.name ?? "no tier"}
      </p>
      <div dangerouslySetInnerHTML={{ __html: item.fieldData.body ?? "" }} />
    </main>
  );
}
