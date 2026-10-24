import { PostList } from "@/components/post-list";

export const metadata = { title: "Featured" };

// `filter: { featured: { eq: true } }` on a Switch field, applied by Webflow.
export default function Featured() {
  return <PostList featured />;
}
