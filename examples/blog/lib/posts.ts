import { cache } from "react";
import { getItemBySlug, getItems } from "@/webflow";
import { schema } from "@/webflow/schema";

// Reference fields to replace with the referenced author items (one cached read of `authors`).
const include = ["author", "coAuthors"] as const;

/** Category options from the generated schema; rerun typegen after adding one in Webflow. */
export const categories = schema.posts.fields.category.options;

/**
 * Published posts, filtered on Webflow's side. Cached under the posts collection tag: the webhook
 * refreshes these pages when a post is published.
 */
export function listPosts({
  categoryId,
  featured,
}: { categoryId?: string | undefined; featured?: boolean | undefined } = {}) {
  return getItems("posts", {
    include,
    sortBy: "name",
    sortOrder: "asc",
    limit: 30,
    filter: {
      // Option filters compare IDs; `undefined` operators are left out of the request.
      category: categoryId ? { eq: categoryId } : undefined,
      featured: featured ? { eq: true } : undefined,
    },
  });
}

/** One post by slug (the staged version in draft mode). `cache` dedupes it across metadata and page. */
export const getPost = cache((slug: string) => getItemBySlug("posts", slug, { include }));

export type PostWithAuthors = NonNullable<Awaited<ReturnType<typeof getPost>>>;
