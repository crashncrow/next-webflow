import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WebflowImage, WebflowRichText, type RichTextElementProps } from "next-webflow/components";
import { getItemBySlug, getItems } from "@/webflow";
import { formatDate, names } from "@/lib/format";

type Props = { params: Promise<{ slug: string }> };

// Prerender every published post. Posts published later render on their first visit
// (`dynamicParams` is true by default), and webhooks keep all of them fresh.
export async function generateStaticParams() {
  const posts = await getItems("posts");
  return posts.map((post) => ({ slug: post.fieldData.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getItemBySlug("posts", (await params).slug);
  return post ? { title: post.fieldData.name } : {};
}

// Rich Text elements can be replaced by tag. Everything else renders as Webflow wrote it (sanitized).
const Quote = ({ children }: RichTextElementProps) => <blockquote className="pull-quote">{children}</blockquote>;

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  // In draft mode (preview links) this reads the staged version instead, uncached.
  const post = await getItemBySlug("posts", slug, { include: ["author", "coAuthors"] });
  if (!post) notFound();
  const { name, body, mainImage, category, author, coAuthors, publishDate } = post.fieldData;
  const byline = [author ? names([author]) : undefined, coAuthors.length ? `with ${names(coAuthors)}` : undefined];

  return (
    <article>
      {category?.name && <span className="tag">{category.name}</span>}
      <h1>{name}</h1>
      <p className="meta">{[...byline, formatDate(publishDate)].filter(Boolean).join(" · ")}</p>
      {mainImage && (
        <WebflowImage image={mainImage} width={1200} height={630} sizes="(min-width: 760px) 728px, 100vw" priority className="hero" />
      )}
      <WebflowRichText html={body} components={{ blockquote: Quote }} />
    </article>
  );
}
