import Link from "next/link";
import { WebflowImage } from "next-webflow/components";
import { getItems } from "@/webflow";
import { formatDate } from "@/lib/format";

export default async function Home() {
  // Cached under the posts collection tag; the webhook refreshes it when a post is published.
  // `include` replaces the author's item ID with the author item (one cached read of `authors`).
  const posts = await getItems("posts", { include: ["author"], sortBy: "lastPublished", sortOrder: "desc" });

  return (
    <>
      <h1>Latest posts</h1>
      <ul className="post-list">
        {posts.map(({ id, fieldData: post }) => (
          <li key={id} className="post-card">
            <WebflowImage image={post.mainImage} width={640} height={360} sizes="(min-width: 760px) 320px, 100vw" />
            <div>
              {/* Option fields are { id, name }: compare by id, display the name. */}
              {post.category?.name && <span className="tag">{post.category.name}</span>}
              <h2>
                <Link href={`/posts/${post.slug}`}>{post.name}</Link>
              </h2>
              <p className="meta">
                {[post.author?.fieldData.name, formatDate(post.publishDate)].filter(Boolean).join(" · ")}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
