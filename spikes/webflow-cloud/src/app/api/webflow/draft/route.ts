import { createDraftHandler } from "next-webflow/draft";
import { schema } from "@/webflow/schema";

// Draft mode, as a user would mount it. No `runtime` export (edge → 500 on Cloud).
export const { GET, DELETE } = createDraftHandler({
  schema,
  resolvePath: (collection, item) =>
    collection === "load-test" ? `/load/${item.fieldData.slug}` : `/library?slug=${item.fieldData.slug}`,
});
