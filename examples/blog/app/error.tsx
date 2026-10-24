"use client";

// Shown if a read fails after next-webflow's retries (for example, Webflow is unreachable).
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="shell py-24 text-center" role="alert">
      <p className="text-xs font-medium text-muted-foreground">A brief interruption</p>
      <h1 className="my-4 text-3xl font-semibold tracking-tight">The content couldn’t be loaded.</h1>
      <p className="mx-auto max-w-md text-sm leading-7 text-muted-foreground">Please try again in a moment.</p>
      <button className="text-link mt-6" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
