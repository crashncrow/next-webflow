"use client";

import { useEffect, useRef, useState } from "react";
import type { ProbeResult } from "@/lib/probe";

type Route = "api/probe" | "api/probe-node";
interface Row extends ProbeResult {
  route: Route;
  sinceRevalidateMs: number | null;
}

// Relative URLs resolve under the mount path injected by Webflow Cloud (page is <mount>/probe).
const url = (path: string) => new URL(path, window.location.href).toString();

export function ProbeClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [polling, setPolling] = useState(false);
  const [secret, setSecret] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const revalidatedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(async () => {
      for (const route of ["api/probe", "api/probe-node"] as const) {
        const result = (await fetch(url(`${route}?tag=spike-probe`), { cache: "no-store" }).then((r) =>
          r.json(),
        )) as ProbeResult;
        const since = revalidatedAt.current === null ? null : Date.now() - revalidatedAt.current;
        setRows((previous) => [{ ...result, route, sinceRevalidateMs: since }, ...previous].slice(0, 60));
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [polling]);

  async function revalidate(route: "api/revalidate" | "api/revalidate-node") {
    const response = await fetch(url(route), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, tag: "spike-probe" }),
    });
    revalidatedAt.current = Date.now();
    const body: unknown = await response.json();
    setLog((previous) => [
      `${new Date().toISOString()} ${route} → ${response.status} ${JSON.stringify(body)}`,
      ...previous,
    ]);
  }

  return (
    <section>
      <h2>Polling (every 2 s, both runtimes)</h2>
      <button onClick={() => setPolling((value) => !value)}>{polling ? "Stop" : "Start"} polling</button>{" "}
      <input
        placeholder="SPIKE_SECRET"
        type="password"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
      />{" "}
      <button onClick={() => revalidate("api/revalidate")}>revalidateTag (edge route)</button>{" "}
      <button onClick={() => revalidate("api/revalidate-node")}>revalidateTag (node route)</button>
      <pre>{log.join("\n")}</pre>
      <table>
        <thead>
          <tr>
            <th>route</th>
            <th>isolate</th>
            <th>servedAt</th>
            <th>fetchedAt</th>
            <th>remaining</th>
            <th>ms</th>
            <th>since revalidate</th>
            <th>error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>{row.route}</td>
              <td>{row.isolate}</td>
              <td>{row.servedAt.slice(11, 19)}</td>
              <td>{row.fetchedAt}</td>
              <td>{row.rateLimitRemaining}</td>
              <td>{row.durationMs}</td>
              <td>{row.sinceRevalidateMs === null ? "" : `${(row.sinceRevalidateMs / 1000).toFixed(1)} s`}</td>
              <td>{row.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
