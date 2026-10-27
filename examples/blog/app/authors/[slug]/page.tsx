import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getItemBySlug, getItems } from "@/webflow";
import { formatDate } from "@/lib/format";
import { listPostsByAuthor } from "@/lib/posts";

type Props = { params: Promise<{ slug: string }> };

// `cache` dedupes the read across metadata and page.
const getAuthor = cache((slug: string) => getItemBySlug("authors", slug));

// Prerender every published author; webhooks keep them fresh.
export async function generateStaticParams() {
  const authors = await getItems("authors");
  return authors.map((author) => ({ slug: author.fieldData.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const author = await getAuthor((await params).slug);
  return author ? { title: author.fieldData.name } : {};
}

export default async function AuthorPage({ params }: Props) {
  const author = await getAuthor((await params).slug);
  if (!author) notFound();
  const posts = await listPostsByAuthor(author.id);

  return (
    <main id="main-content" className="shell py-10">
      <Link className="back-link" href="/">
        ← Back to examples
      </Link>
      <header className="my-8">
        <p className="text-sm text-muted-foreground">Author</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{author.fieldData.name}</h1>
      </header>

      {posts.length === 0 && <p className="py-12 text-sm text-muted-foreground">No published posts yet.</p>}

      <ul aria-label={`Posts by ${author.fieldData.name}`}>
        {posts.map(({ post, role }) => {
          const date = post.fieldData.publishDate ?? post.lastPublished;
          return (
            <li key={post.id} className="border-b py-4 last:border-b-0">
              <Link href={`/posts/${post.fieldData.slug}`} className="font-medium underline-offset-4 hover:underline">
                {post.fieldData.name}
              </Link>
              <p className="meta mt-1">
                <span>{role === "author" ? "Author" : "Co-author"}</span>
                {date && <time dateTime={date}>{formatDate(date)}</time>}
              </p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
