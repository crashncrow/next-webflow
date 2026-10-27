import type { Metadata } from "next";
import Link from "next/link";
import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import { WebflowImage, WebflowRichText, type RichTextElementProps } from "next-webflow/components";
import { getItems } from "@/webflow";
import { AuthorLinks } from "@/components/author-links";
import { PostBadges } from "@/components/post-badges";
import { PreviewNotice } from "@/components/preview-notice";
import { PostVideo } from "@/components/post-video";
import { excerpt, formatDate, hasEmptyCodeBlock, httpsUrl, readingMinutes } from "@/lib/format";
import { hasDraft } from "@/lib/demo-previews";
import { getPost } from "@/lib/posts";
import banner from "@/public/webflow-next-banner.webp";

type Props = { params: Promise<{ slug: string }> };

// Prerender every published post. Posts published later render on their first visit
// (`dynamicParams` is true by default), and webhooks keep all of them fresh.
export async function generateStaticParams() {
  const posts = await getItems("posts");
  return posts.map((post) => ({ slug: post.fieldData.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPost((await params).slug);
  if (!post) return {};
  const { name, body, mainImage, publishDate } = post.fieldData;
  const description = excerpt(body);
  // The post's main image (an absolute Webflow CDN URL) for link previews; the site banner otherwise.
  // (A page's `openGraph` replaces the layout's, so the banner is set again here.)
  const images = mainImage
    ? [{ url: mainImage.url, alt: mainImage.alt ?? "" }]
    : [{ url: banner.src, width: banner.width, height: banner.height, alt: "Webflow + Next.js" }];
  return {
    title: name,
    description,
    openGraph: {
      type: "article",
      title: name,
      description,
      ...(publishDate ? { publishedTime: publishDate } : {}),
      images,
    },
    twitter: { card: "summary_large_image", title: name, description, images },
  };
}

// Rich Text elements can be replaced by tag. Everything else renders as Webflow wrote it (sanitized).
const Quote = ({ children }: RichTextElementProps) => (
  <aside className="my-6 border-l-2 pl-5 text-lg text-muted-foreground italic">{children}</aside>
);

export default async function PostPage({ params }: Props) {
  // In draft mode (preview links) this reads the staged version instead, uncached.
  const post = await getPost((await params).slug);
  if (!post) notFound();
  const fields = post.fieldData;
  const date = fields.publishDate ?? post.lastPublished;
  // `include` resolved the references: a missing author is `null`, missing co-authors are left out.
  const authors = [fields.author, ...fields.coAuthors];
  const gallery = (fields.gallery ?? []).filter((image) => image.url !== fields.mainImage?.url);
  const website = httpsUrl(fields.website);
  const attachment = httpsUrl(fields.attachment?.url);
  // Demo only: offer a public preview of this post's unpublished changes (lib/demo-previews.ts).
  const showPreviewButton = !(await draftMode()).isEnabled && (await hasDraft(post.id));

  return (
    <main id="main-content" className="shell py-10">
      <Link className="back-link" href="/">
        ← Back to examples
      </Link>
      <article>
        <header
          className={`my-8 ${fields.accentColor ? "border-l-4 pl-5" : ""}`}
          // Color fields are CSS color strings.
          style={fields.accentColor ? { borderLeftColor: fields.accentColor } : undefined}
        >
          <PostBadges category={fields.category} featured={fields.featured} categoryFirst />
          <h1 className="my-4 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">{fields.name}</h1>
          <p className="meta">
            <AuthorLinks authors={authors} />
            {date && <time dateTime={date}>{formatDate(date)}</time>}
            <span>{readingMinutes(fields.body, fields.readingTime)} min read</span>
          </p>
          {showPreviewButton && (
            // A plain <a>: the route sets the draft mode cookie and redirects back here.
            <a
              href={`/api/preview?item=${post.id}`}
              className="mt-5 inline-flex min-h-10 items-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90"
            >
              Try draft preview
            </a>
          )}
        </header>

        {fields.mainImage && (
          <WebflowImage
            image={fields.mainImage}
            width={1200}
            height={675}
            sizes="(max-width: 767px) 100vw, 704px"
            priority
            className="mb-8 aspect-video w-full rounded-lg object-cover"
          />
        )}

        {hasEmptyCodeBlock(fields.body) && (
          <aside
            aria-labelledby="code-block-limitation"
            className="mb-8 rounded-lg border bg-muted/50 p-5 text-sm leading-6"
          >
            <h2 id="code-block-limitation" className="font-semibold">
              Known limitation: native code blocks
            </h2>
            <p className="mt-2 text-muted-foreground">
              Webflow’s API returns native Rich Text code blocks empty, even when they contain code in the editor.
              Missing code can’t be displayed on this page.
            </p>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              <a
                className="underline underline-offset-4"
                href="https://github.com/crashncrow/next-webflow/tree/main/packages/next-webflow#known-limitations"
                target="_blank"
                rel="noopener noreferrer"
              >
                Known limitations on GitHub
              </a>
              <a
                className="underline underline-offset-4"
                href="https://developers.webflow.com/data/reference/field-types-item-values#rich-text"
                target="_blank"
                rel="noopener noreferrer"
              >
                Webflow API documentation
              </a>
            </p>
          </aside>
        )}

        <WebflowRichText html={fields.body} className="article-body w-richtext" components={{ blockquote: Quote }} />

        {gallery.length > 0 && (
          <section aria-label="Image gallery" className="my-8 grid gap-5 sm:grid-cols-2">
            {gallery.map((image) => (
              <figure key={image.url}>
                <WebflowImage
                  image={image}
                  width={960}
                  height={640}
                  sizes="(max-width: 639px) 100vw, 344px"
                  className="h-auto w-full rounded-md"
                />
                {image.alt && <figcaption className="mt-2 text-xs text-muted-foreground">{image.alt}</figcaption>}
              </figure>
            ))}
          </section>
        )}

        {/* A Video link field is { url, metadata }: build the player from the URL. */}
        {fields.video && (
          <div className="my-8">
            <PostVideo video={fields.video} title={fields.name} />
          </div>
        )}

        {(website || fields.contactEmail || fields.phone) && (
          <section aria-label="Contact" className="mt-8 rounded-lg border p-5">
            <h2 className="text-base font-semibold">Get in touch</h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
              {website && (
                <>
                  <dt className="text-muted-foreground">Website</dt>
                  <dd>
                    <a className="text-link" href={website} target="_blank" rel="noopener noreferrer">
                      Visit website
                    </a>
                  </dd>
                </>
              )}
              {fields.contactEmail && (
                <>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="min-w-0 break-words">
                    <a className="underline underline-offset-4" href={`mailto:${fields.contactEmail}`}>
                      {fields.contactEmail}
                    </a>
                  </dd>
                </>
              )}
              {fields.phone && (
                <>
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd>
                    <a className="underline underline-offset-4" href={`tel:${fields.phone.replace(/[\s().-]/g, "")}`}>
                      {fields.phone}
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </section>
        )}

        {attachment && (
          <section aria-label="Attachment" className="mt-6 rounded-lg border p-5">
            <h2 className="text-base font-semibold">Attachment</h2>
            <a
              className="mt-3 inline-flex max-w-full items-center gap-2 text-sm underline underline-offset-4"
              href={attachment}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="min-w-0 break-words">
                {fields.attachment?.alt || decodeURIComponent(attachment.split("/").pop() ?? "Open attachment")}
              </span>
            </a>
          </section>
        )}
      </article>
      <PreviewNotice />
      <nav className="mt-10 pt-6" aria-label="Post navigation">
        <Link className="back-link" href="/">
          ← Back to examples
        </Link>
      </nav>
    </main>
  );
}
