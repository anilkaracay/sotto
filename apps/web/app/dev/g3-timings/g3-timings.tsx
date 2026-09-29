"use client";

// Runs the Gate G3 measurements in a Web Worker, as the product's crypto worker does, or on the page
// itself with ?where=main (for Chrome's CPU throttling, which slows the page), and shows the result
// as JSON for scripts/g3-browser-timings.ts to read. Throwaway keys only; nothing is sent anywhere.
import { useEffect, useState } from "react";
import type { G3Result } from "./measure";

export function G3Timings() {
  const [result, setResult] = useState<G3Result | { error: string } | null>(null);
  useEffect(() => {
    const where = new URLSearchParams(window.location.search).get("where") ?? "worker";
    if (where === "main") {
      void import("./measure").then(({ measure }) =>
        measure("main").then(setResult, (error: unknown) => setResult({ error: String(error) })),
      );
      return;
    }
    const worker = new Worker(new URL("./g3.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<G3Result | { error: string }>) => {
      setResult(event.data);
      worker.terminate();
    };
    worker.postMessage("run");
    return () => worker.terminate();
  }, []);
  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>Gate G3 timings</h1>
      {result ? (
        <pre data-testid="g3-results">{JSON.stringify(result, null, 2)}</pre>
      ) : (
        <p>Measuring…</p>
      )}
    </main>
  );
}
