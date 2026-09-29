// Gate G3 browser timings (step 2.2): opens the dev only page /dev/g3-timings of `next dev` in the
// installed Google Chrome (Playwright channel "chrome", headless) and prints what it measured: in the
// Web Worker as the product runs its proofs, and on the page with and without Chrome's 4x CPU
// throttling (a stand in for a slower laptop than the development machine). Nothing is sent to any
// cluster.
//
// Usage: pnpm --filter @sotto/web dev, then node tests/e2e/g3-browser-timings.ts [--url http://localhost:3000]
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { values } = parseArgs({ options: { url: { type: "string" } } });
const base = values.url ?? "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });

async function run(where: "worker" | "main", throttle: number) {
  const page = await browser.newPage();
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  await page.goto(`${base}/dev/g3-timings?where=${where}`);
  const text = await page.getByTestId("g3-results").textContent({ timeout: 600_000 });
  await page.close();
  return { where, throttle, result: JSON.parse(text ?? "{}") as unknown };
}

const runs = [];
// The first load compiles the page and the worker in next dev; it is a warm up.
await run("worker", 1);
runs.push(await run("worker", 1));
runs.push(await run("main", 1));
runs.push(await run("worker", 4));
runs.push(await run("main", 4));
console.log(JSON.stringify({ chrome: browser.version(), runs }, null, 2));
await browser.close();
