// The demo company's browser modules never reach a wallet (step 4.6, D-32; the founder's constraint
// 3): nothing in demo mode can trigger a wallet prompt or a transaction. This walks every module the
// demo's pages import, by their source, and fails if any of them is a wallet library, the app's
// wallet or key session code, or the app's API client, which sends the session cookie and writes.
// The browser spec (tests/e2e/specs/demo.spec.ts) proves the same at run time with a wallet that
// records every call.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = join(WEB, "app", "demo");

/** Packages that connect to a wallet, ask it to sign, or build what it would sign. */
const WALLET_PACKAGES = [
  /^@wallet-standard\//,
  /^@solana\/react$/,
  /^@solana\/wallet-/,
  /^@solana-program\//,
  /^@sotto\/sdk\/(tx|proofs|wrap)(\/|$)/,
  // The confidential module but for its public part (amount formatting, no key and no proof).
  /^@sotto\/sdk\/confidential($|\/(?!public$))/,
];
/** The app's own modules that hold a wallet, real keys, or the cookie carrying API client. */
const APP_MODULES = [
  /\/app\/app\/_components\/(key-session|sign-in-screen|privacy)\.tsx$/,
  /\/app\/app\/_components\/confidential\//,
  /\/lib\/client\/(api|auth|records|rpc|wallet-report|balance-snapshot|grant-viewers)\.ts$/,
  /\/lib\/crypto-worker\/(key-session|unlock|auto-lock)\.ts$/,
];

/**
 * What the demo's browser code imports from outside the app, in full. @solana/kit comes with the
 * crypto worker's client (its encoder for the plans of the signed in app), whose demo worker refuses
 * every request but opening (apps/web/test/crypto-worker.test.ts).
 */
const EXPECTED = [
  "@solana/kit",
  "@sotto/sdk/cluster/assets",
  "@sotto/sdk/confidential/public",
  "@sotto/sdk/disclosure",
  "@sotto/ui",
];

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** The module specifiers a file imports, type only imports left out (they are erased). */
function imports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)) {
    if (!match[1]) found.push(match[2] as string);
  }
  for (const match of text.matchAll(/import\("([^"]+)"\)/g)) found.push(match[1] as string);
  return found;
}

function walk(entry: string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of imports(file)) {
      if (!specifier.startsWith(".")) {
        packages.add(specifier);
        continue;
      }
      const target = resolve(dirname(file), specifier);
      // Styles and the worker script's URL are not modules of the page. The server's modules
      // (lib/server) render the pages and never reach the browser; the browser's code imports
      // only their types.
      if (existsSync(target) && /\.(ts|tsx)$/.test(target) && !target.includes("/lib/server/")) {
        queue.push(target);
      }
    }
  }
  return { files, packages };
}

describe("the demo company's pages (step 4.6, D-32)", () => {
  const graph = walk(sources(DEMO));

  it("import no wallet library and nothing that builds a transaction", () => {
    expect(graph.files.size).toBeGreaterThan(12);
    for (const name of graph.packages) {
      for (const wallet of WALLET_PACKAGES) expect(name, name).not.toMatch(wallet);
    }
    // What they do import from outside the app, in full.
    expect([...graph.packages].filter((name) => name.startsWith("@")).sort()).toEqual(EXPECTED);
  });

  it("import none of the app's wallet, key session or cookie carrying modules", () => {
    for (const file of graph.files) {
      for (const module of APP_MODULES) expect(file, file).not.toMatch(module);
    }
    // The reader they do use is the demo's own, with the worker client and nothing of a session.
    const names = [...graph.files].map((file) => file.slice(WEB.length));
    expect(names).toContain("/lib/client/demo.ts");
    expect(names).toContain("/lib/crypto-worker/client.ts");
  });

  it("send only reads of the demo's routes, marked as the demo's, without a cookie", () => {
    const client = readFileSync(join(WEB, "lib", "client", "demo.ts"), "utf8");
    expect(client.match(/fetch\(/g)).toHaveLength(1);
    expect(client).toContain('method: "GET"');
    expect(client).toContain('credentials: "omit"');
    expect(client).toContain("[DEMO_HEADER]");
    for (const file of sources(DEMO)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bfetch\(/);
      expect(text, file).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
      // No form and no button: nothing on a demo screen submits or acts.
      expect(text, file).not.toMatch(/<form\b|<button\b|<Button\b|onSubmit/);
    }
  });
});
