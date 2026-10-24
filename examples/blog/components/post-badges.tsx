import Link from "next/link";

/** The post's category (an Option field: `{ id, name }`) and Featured (a Switch), as filter links. */
export function PostBadges({
  category,
  featured,
  categoryFirst = false,
  className = "",
}: {
  category: { id: string; name: string | undefined } | undefined;
  featured: boolean | undefined;
  categoryFirst?: boolean;
  className?: string;
}) {
  // `name` is undefined only for an option neither the generated schema nor the API knows.
  const categoryBadge = category?.name && (
    <Link
      href={`/category/${encodeURIComponent(category.id)}`}
      aria-label={`Filter by category: ${category.name}`}
      className={`badge border-transparent bg-muted text-muted-foreground hover:text-foreground ${className}`}
    >
      {category.name}
    </Link>
  );
  const featuredBadge = featured && (
    <Link href="/featured" className={`badge ${className}`}>
      Featured
    </Link>
  );
  if (!categoryBadge && !featuredBadge) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {categoryFirst ? categoryBadge : featuredBadge}
      {categoryFirst ? featuredBadge : categoryBadge}
    </div>
  );
}
