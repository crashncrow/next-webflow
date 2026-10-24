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
  if (!categories.some((category) => category.id === id)) notFound();
  // Option filters compare by ID: `filter: { category: { eq: id } }`.
  return <PostList categoryId={id} />;
}
