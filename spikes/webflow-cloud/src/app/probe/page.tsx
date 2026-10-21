import { probe } from "@/lib/probe";
import { ProbeClient } from "./ProbeClient";

export const dynamic = "force-dynamic";

export default async function ProbePage() {
  const result = await probe("spike-probe", "page (node)");
  return (
    <main>
      <h1>Data cache probe</h1>
      <p>
        Server render: <code>{JSON.stringify(result)}</code>
      </p>
      <p>
        <strong>Cached</strong> = <code>fetchedAt</code> and <code>rateLimitRemaining</code> stay the same across
        reloads, and <code>durationMs</code> is small. Watch whether that holds across different <code>isolate</code>{" "}
        values (shared cache) or only within one (in-memory).
      </p>
      <ProbeClient />
    </main>
  );
}
