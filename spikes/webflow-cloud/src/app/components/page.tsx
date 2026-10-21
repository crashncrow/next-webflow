import { createWebflow } from "next-webflow";
import { DraftModeBanner, WebflowImage, WebflowRichText, type WebflowComponentProps } from "next-webflow/components";
import { schema } from "@/webflow/schema";
import probes from "./probes.json";

// Spike only (stage 7): components rendered at request time, so the Rich Text parser runs in
// workerd (not at build). Probes: Rich Text with execution vectors, as read back from the API.
export const dynamic = "force-dynamic";
const cms = createWebflow({ schema });

const Callout = ({ props, slots, slotIds }: WebflowComponentProps) => (
  <aside id="callout" data-title={props.title}>
    {slots[slotIds.Body ?? ""]}
  </aside>
);

export default async function ComponentsPage() {
  const post = await cms.getItemBySlug("posts", "cms-future-10");
  const extra =
    '<p><a id="internal" href="/load/load-test-item-1">internal</a> <a id="external" href="https://example.com">external</a></p>' +
    '<wf-component name="Callout" prop-title="Heads up"><wf-prop name="b1" label="Body"><p>Bring your towel.</p></wf-prop></wf-component>';
  return (
    <main>
      <h1>Components</h1>
      <section id="body">
        <WebflowRichText html={post?.fieldData.body} />
      </section>
      <section id="extra">
        <WebflowRichText html={extra} webflowComponents={{ Callout }} />
      </section>
      <section id="probes">
        <WebflowRichText html={Object.values(probes).join("")} />
      </section>
      <section id="image">
        <WebflowImage image={post?.fieldData.mainImage} width={640} height={360} sizes="640px" />
      </section>
      <DraftModeBanner />
    </main>
  );
}
