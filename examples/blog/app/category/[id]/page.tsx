import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostList } from "@/components/post-list";
import { categories } from "@/lib/posts";

type Props = { params: Promise<{ id: string }> };

// One page per option of the Category field, from the generated schema.
export function generateStaticParams() {
  return categories.map((category) => ({ id: category.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: categories.find((category) => category.id === id)?.name ?? "Category" };
}

export default async function Category({ params }: Props) {
  const { id } = await params;
  // Option filters only accept the schema's option IDs: find the URL's ID there first.
  const category = categories.find((option) => option.id === id);
  if (!category) notFound();
  return <PostList categoryId={category.id} />;
}
