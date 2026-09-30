// The landing in the browser (F-17, AC-17.1; step 3.1): the production build serves `/` from
// design/sotto-landing.html with the copy corrections of 13, without a console error or warning, at
// 1440, and at 390 and 360 without a horizontal scroll; Sign in opens the app. Since step 3.2 (AC-17.2)
// the request access form stores a request with the visitor's consent and says thanks.
import { expect, firefox, test, type Page } from "@playwright/test";

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

test("AC-17.1 serves the landing with its corrected copy and no console error", async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Private books.");
  await expect(page.getByText("Beta on Solana devnet").first()).toBeVisible();
  await expect(page.getByTestId("landing-facts")).toContainText(
    "A confidential payment is one Solana transaction with a version 1 wallet.",
  );
  await expect(page.getByText("Built for Colosseum's Crypto World's Fair")).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/\b(True|False)\b|one transaction|open source|mainnet-beta/i);
  // The hero's views change on a timer; the page keeps running without a problem.
  await page.waitForTimeout(4500);
  expect(problems).toEqual([]);
  // Sign in opens the app, which sends a visitor without a session to its sign in screen.
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
});

// The phone audit of the founder's review (2026-09-30): at 390 and 360, no horizontal page scroll, no
// visible text under 12px, no tap target under 40px, and text past the screen edge only inside its own
// scrolling container (the SDK code pane).
async function phoneAudit(page: Page, width: number) {
  return page.evaluate((viewport) => {
    const shown = (el: Element) => {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (Number(style.opacity) === 0 || node.getAttribute("aria-hidden") === "true")
          return false;
      }
      return true;
    };
    const scrollsInside = (el: Element) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const overflow = getComputedStyle(node).overflowX;
        if (overflow === "auto" || overflow === "scroll")
          return node.getBoundingClientRect().right <= viewport + 1;
      }
      return false;
    };
    const small: string[] = [];
    const taps: string[] = [];
    const past: string[] = [];
    for (const el of document.querySelectorAll(".p5 *")) {
      if (!shown(el)) continue;
      const label = (el.textContent ?? "").trim().slice(0, 40);
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
      const box = el.getBoundingClientRect();
      if (ownText && parseFloat(getComputedStyle(el).fontSize) < 12) small.push(label);
      // Layout size, not the painted box: the hero card eases in with a transform.
      const target = el as HTMLElement;
      if (el.matches("a, button, input") && (target.offsetWidth < 40 || target.offsetHeight < 40)) {
        taps.push(
          `${label || el.getAttribute("aria-label")} ${target.offsetWidth}x${target.offsetHeight}`,
        );
      }
      if (ownText && (box.right > viewport + 1 || box.left < -1) && !scrollsInside(el))
        past.push(label);
    }
    return { scrollWidth: document.documentElement.scrollWidth, small, taps, past };
  }, width);
}

for (const width of [390, 360]) {
  test(`AC-17.1 fits a ${width} pixel phone: no page scroll, no small text or tap target`, async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Every section drawn once, so lazy images and reveals settle before the audit.
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 700) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    });
    const audit = await phoneAudit(page, width);
    expect(audit.scrollWidth).toBeLessThanOrEqual(width);
    expect(audit.small).toEqual([]);
    expect(audit.taps).toEqual([]);
    expect(audit.past).toEqual([]);
    expect(problems).toEqual([]);
  });
}

// The story is a 320vh sticky section driven by `animation-timeline`. Where motion is reduced, and in a
// browser without scroll timelines (Firefox 155), it shows its final readable state with no empty
// space: the section is as tall as its text and the progress bar is gone.
async function storyState(page: Page) {
  return page.locator("section.story").evaluate((story) => ({
    height: story.getBoundingClientRect().height,
    viewport: window.innerHeight,
    sticky: getComputedStyle(story.querySelector(".stick") as Element).position,
    progress: getComputedStyle(story.querySelector(".sprog") as Element).display,
  }));
}

test("AC-17.1 shows the story's readable state when motion is reduced", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const state = await storyState(page);
  expect(state.sticky).toBe("relative");
  expect(state.progress).toBe("none");
  expect(state.height).toBeLessThan(state.viewport * 1.5);
});

test("AC-17.1 shows the story's readable state in Firefox, which has no scroll timelines", async ({
  baseURL,
}) => {
  const browser = await firefox.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${baseURL}/`);
    expect(await page.evaluate(() => CSS.supports("animation-timeline: view()"))).toBe(false);
    const state = await storyState(page);
    expect(state.sticky).toBe("relative");
    expect(state.progress).toBe("none");
    expect(state.height).toBeLessThan(state.viewport * 1.5);
    // Without the timeline the story's words keep their ink color instead of the faded start.
    const color = await page
      .locator("section.story .sw")
      .first()
      .evaluate((word) => getComputedStyle(word).color);
    expect(color).toBe("rgb(11, 24, 48)");
  } finally {
    await browser.close();
  }
});

test("AC-17.2 stores a request with the visitor's consent and says thanks", async ({ page }) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const form = page.getByTestId("request-access");
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel("Work email", { exact: true }).fill(`landing-${Date.now()}@example.com`);
  await form.getByLabel("Company", { exact: true }).fill("Example Ltd");
  // The consent box takes the pointer where the page first shows it.
  expect(
    await form.getByRole("checkbox").evaluate((box) => {
      const r = box.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === box;
    }),
  ).toBe(true);
  // Without the consent box, nothing is sent.
  await form.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByTestId("request-access-problem")).toHaveText(
    "Tick the box to agree that Sotto stores your details.",
  );
  // The consent box takes the pointer: nothing, such as the footer's watermark, lies over it.
  const covered = await form.getByRole("checkbox").evaluate((box) => {
    const r = box.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== box;
  });
  expect(covered).toBe(false);
  await form.getByRole("checkbox").check();
  const sent = page.waitForResponse((response) => response.url().endsWith("/api/waitlist"));
  await form.getByRole("button", { name: "Request access" }).click();
  expect((await sent).status()).toBe(201);
  await expect(page.getByTestId("request-access-done")).toHaveText("Thanks, we will be in touch");
  expect(problems).toEqual([]);
});
