import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="shell py-24 text-center">
      <p className="text-xs font-medium text-muted-foreground">404</p>
      <h1 className="my-4 text-3xl font-semibold tracking-tight">This page isn’t here.</h1>
      <p className="mx-auto max-w-md text-sm leading-7 text-muted-foreground">
        It may have moved, or the post hasn’t been published yet.
      </p>
      <Link className="back-link mt-6" href="/">
        ← Back to examples
      </Link>
    </main>
  );
}
