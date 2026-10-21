// app/drafts/page.tsx
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createWebflowCms, unsafeStagedCache } from "next-webflow";
import { createPreviewUrl, requireBasicAuth } from "next-webflow/draft";
import { schema } from "@/webflow/schema";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

// Staged content, never cached. Only on this authenticated page.
const staged = createWebflowCms({ schema, cache: unsafeStagedCache });

export default async function Drafts() {
  // Second check: if the proxy's matcher ever misses this page, it still shows nothing.
  if (await requireBasicAuth(await headers(), { password: process.env.DRAFTS_PASSWORD })) notFound();

  const posts = (await staged.getItems("posts")).filter((post) => post.isDraft);
  const links = await Promise.all(
    posts.map((post) => createPreviewUrl({ url: "/api/webflow/draft", collection: "posts", itemId: post.id })),
  );
  return (
    <ul>
      {posts.map((post, index) => (
        <li key={post.id}>
          <Link href={links[index] ?? "#"} prefetch={false}>
            {post.fieldData.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
