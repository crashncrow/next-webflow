import type { OptionIdOf } from "next-webflow";
import { cache } from "react";
import { getItemBySlug, getItems } from "@/webflow";
import { schema } from "@/webflow/schema";

// Reference fields to replace with the referenced author items (one cached read of `authors`).
const include = ["author", "coAuthors"] as const;

/** Category options from the generated schema; rerun typegen after adding one in Webflow. */
export const categories = schema.posts.fields.category.options;

/** A Category option ID: Option filters only accept the IDs in the generated schema. */
export type CategoryId = OptionIdOf<typeof schema, "posts", "category">;

/**
 * Published posts, filtered on Webflow's side. Cached under the posts collection tag: the webhook
 * refreshes these pages when a post is published.
 */
export function listPosts({
  categoryId,
  featured,
}: { categoryId?: CategoryId | undefined; featured?: boolean | undefined } = {}) {
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

/**
 * Published posts by an author, as main author or co-author. Webflow can't filter on a
 * Multi-reference field, so this reads every post (references as IDs) and filters here.
 */
export async function listPostsByAuthor(authorId: string) {
  const posts = await getItems("posts", { sortBy: "name", sortOrder: "asc" });
  return posts
    .filter(({ fieldData }) => fieldData.author === authorId || fieldData.coAuthors?.includes(authorId))
    .map((post) => ({ post, role: post.fieldData.author === authorId ? "author" : "co-author" }) as const);
}

/** One post by slug (the staged version in draft mode). `cache` dedupes it across metadata and page. */
export const getPost = cache((slug: string) => getItemBySlug("posts", slug, { include }));

export type PostWithAuthors = NonNullable<Awaited<ReturnType<typeof getPost>>>;
