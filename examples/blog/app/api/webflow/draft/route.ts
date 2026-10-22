import { createDraftHandler } from "next-webflow/draft";
import { schema } from "@/webflow/schema";

// Preview links (see /drafts) land here: the route checks the signature, reads the staged item,
// enables draft mode and redirects to the item's current path. Don't export `runtime`.
export const { GET, DELETE } = createDraftHandler({
  schema,
  resolvePath: (collection, item) => (collection === "posts" ? `/posts/${item.fieldData.slug}` : "/"),
});
