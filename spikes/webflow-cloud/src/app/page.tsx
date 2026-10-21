import Link from "next/link";

export const dynamic = "force-dynamic";

export default function Home() {
  const configured = {
    WEBFLOW_API_TOKEN: Boolean(process.env.WEBFLOW_API_TOKEN),
    WEBFLOW_SITE_ID: Boolean(process.env.WEBFLOW_SITE_ID),
    SPIKE_SECRET: Boolean(process.env.SPIKE_SECRET),
  };
  return (
    <main>
      <h1>next-webflow · Webflow Cloud spike</h1>
      <p>Env configured: {JSON.stringify(configured)}</p>
      <ol>
        <li>
          <Link href="/probe">Data cache persistence + revalidateTag</Link>
        </li>
        <li>
          <Link href="/pagination">Pagination vs the 6 concurrent requests limit</Link>
        </li>
        <li>
          <Link href="/library">Library on real data (normalization, schema fallback)</Link>
        </li>
      </ol>
    </main>
  );
}
