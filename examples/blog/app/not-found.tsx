import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p>
        This post doesn&apos;t exist or isn&apos;t published. <Link href="/">Back to the blog</Link>
      </p>
    </>
  );
}
