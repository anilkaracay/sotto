// Accessibility (step 3.10, docs/09-FRONTEND.md section 7): an axe scan (WCAG 2.1 A and AA, color
// contrast included) of every state the specs take a screenshot of, failing on any violation with
// the rule, its impact and the first elements it found. With SOTTO_A11Y_REPORT=1 it prints the
// violations of every state instead of failing at the first, to list them all in one run.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function expectAccessible(page: Page, name: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  // With the privacy screen on (F-15) the amounts are blurred to be unreadable on purpose; the rest
  // of the page is still checked.
  if ((await page.locator('[data-privacy="on"]').count()) > 0)
    builder = builder.exclude("[data-amount]");
  const results = await builder.analyze();
  const problems = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "unknown"}): ${violation.nodes.length} on ${violation.nodes
        .slice(0, 4)
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
  if (process.env.SOTTO_A11Y_REPORT === "1") {
    for (const problem of problems) console.log(`A11Y ${name}: ${problem}`);
    return;
  }
  expect(problems, `accessibility of ${name}`).toEqual([]);
}

const consoles = new WeakMap<Page, string[]>();

/**
 * The console errors, warnings and uncaught page errors of `page` since its last check. The first
 * call starts listening, so a spec calls it once when it opens a page.
 */
export function watchConsole(page: Page): string[] {
  let problems = consoles.get(page);
  if (!problems) {
    const list: string[] = [];
    problems = list;
    consoles.set(page, list);
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        list.push(`console ${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => list.push(`page error: ${error.message}`));
  }
  return problems;
}

/**
 * No console error or warning and no uncaught error on `page` up to this state. A state that shows a
 * refusal on purpose names its response's status in `refused`: the browser itself logs a 4xx
 * response as "Failed to load resource", and only that line, with that status, is let through.
 */
export function expectQuietConsole(page: Page, name: string, refused?: number): void {
  const expected = refused
    ? `console error: Failed to load resource: the server responded with a status of ${refused} `
    : null;
  const problems = watchConsole(page)
    .splice(0)
    .filter((problem) => !(expected && problem.startsWith(expected)));
  if (process.env.SOTTO_A11Y_REPORT === "1") {
    for (const problem of problems) console.log(`CONSOLE ${name}: ${problem}`);
    return;
  }
  expect(problems, `console of ${name}`).toEqual([]);
}
