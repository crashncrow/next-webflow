import Image from "next/image";
import Link from "next/link";
import { WebflowImage } from "next-webflow/components";
import banner from "@/public/webflow-next-banner.webp";
import { CategoryTabs } from "@/components/category-tabs";
import { PostBadges } from "@/components/post-badges";
import { PreviewNotice } from "@/components/preview-notice";
import { PostIcon } from "@/components/post-icon";
import { excerpt, formatDate } from "@/lib/format";
import { categories, listPosts, type CategoryId } from "@/lib/posts";

/** The home page, `/featured` and `/category/[id]`: the same list with a different filter. */
export async function PostList({ categoryId, featured = false }: { categoryId?: CategoryId; featured?: boolean }) {
  const posts = await listPosts({ categoryId, featured });
  const category = categories.find((option) => option.id === categoryId);

  return (
    <main id="main-content" className="shell pt-8 sm:pt-10">
      <header className="mb-6 sm:mb-8">
        <Image
          src={banner}
          alt="Webflow + Next.js"
          unoptimized // already a small WebP
          priority
          className="mb-8 h-auto w-full rounded-lg grayscale transition-[filter] duration-300 hover:grayscale-0 motion-reduce:transition-none"
        />
        <h1 className="text-3xl font-semibold tracking-tight">{category?.name ?? (featured ? "Featured" : "Posts")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Webflow CMS content in a Next.js app, with next-webflow.</p>
      </header>

      <CategoryTabs categories={categories} categoryId={categoryId} featured={featured} />

      {posts.length === 0 && (
        <p className="py-12 text-sm text-muted-foreground">
          {category ? `No published posts in ${category.name} yet.` : "No published posts yet."}
        </p>
      )}

      <ul aria-label="Posts">
        {posts.map((item, index) => {
          const { id, fieldData: post, lastPublished } = item;
          const image = post.mainImage ?? post.gallery?.[0];
          const date = post.publishDate ?? lastPublished;
          return (
            <li key={id} className="border-b last:border-b-0">
              <div className="group relative grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-6 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-x-5">
                <span className="flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {image ? (
                    <WebflowImage
                      image={image}
                      alt=""
                      width={40}
                      height={40}
                      loading={index === 0 ? "eager" : "lazy"}
                      className="size-10 object-cover"
                    />
                  ) : (
                    <PostIcon post={item} />
                  )}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-base leading-snug font-semibold tracking-tight group-hover:underline group-hover:underline-offset-4 sm:text-lg">
                    {/* The ::after overlay makes the whole row clickable; the badges sit above it. */}
                    <Link href={`/posts/${post.slug}`} className="after:absolute after:inset-0 after:rounded-md">
                      {post.name}
                    </Link>
                  </h2>
                  <p className="mt-2 truncate text-sm leading-relaxed text-muted-foreground">{excerpt(post.body)}</p>
                </div>
                <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-2 sm:col-start-auto sm:flex-col sm:items-end">
                  <PostBadges
                    category={post.category}
                    featured={post.featured}
                    className="px-1.5 py-0 text-[11px] leading-5 font-medium"
                  />
                  {date && (
                    <time dateTime={date} className="text-xs text-muted-foreground">
                      {formatDate(date)}
                    </time>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <PreviewNotice />
    </main>
  );
}
