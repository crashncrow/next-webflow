import { createWebflow } from "next-webflow";
import { schema } from "@/webflow/schema";

// Spike only (stage 5b): a STATIC page listing a collection that may never have been published.
// Prerendered at build; must still be invalidated by the first site publish (webhook → `webflow` tag).
const cms = createWebflow({ schema, logger: { warn: console.warn, debug: console.log } });

export default async function NeverPage() {
  const items = await cms.getItems("never-published");
  return (
    <main>
      <h1>never-published</h1>
      <p id="count">{items.length} items</p>
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.fieldData.name}</li>
        ))}
      </ul>
      <p>Rendered at {new Date().toISOString()}</p>
    </main>
  );
}
