// The landing in the browser (F-17, AC-17.1; step 3.1): the production build serves `/` from
// the approved landing design with the approved copy corrections, without a console error or warning, at
// 1440, and at 390 and 360 without a horizontal scroll; Sign in opens the app. Since step 3.2 (AC-17.2)
// the request access form stores a request with the visitor's consent and says thanks. Since step 3.8
// the approved landing at 1440 and 390 is compared with its baselines, its clock paused so the hero's
// views hold still; since step 4.4 also at 1280 and 430.
import { expect, firefox, test, type Page } from "@playwright/test";
import { expectVisual, VISUAL } from "../visual.ts";

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
    "A confidential payment is one Solana transaction in Solflare.",
  );
  await expect(page.getByText("\u00a9 2026 Sotto \u00b7 A Cayvox Labs product.")).toBeVisible();
  await expect(
    page.getByText("All trademarks are property of their respective owners."),
  ).toBeVisible();
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
      // Layout size, not the painted box: the hero card eases in with a transform. A box inside
      // its label is tapped through the label.
      const target = (el.matches("label input") ? el.closest("label") : el) as HTMLElement;
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

for (const width of [1440, 1280, 430, 390]) {
  test(`AC-17.1 matches the approved landing at ${width}`, async ({ page }) => {
    test.skip(!VISUAL, "visual checks run in the local CI (SOTTO_VISUAL=1)");
    const at = new Date("2026-10-01T09:00:00.000Z");
    await page.clock.install({ time: at });
    await page.clock.pauseAt(at);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Private books.");
    await page.evaluate(() => document.fonts.ready);
    await expectVisual(page, `landing-${width}`);
  });
}

// Step 4.12: the footer wordmark's focus follows the mouse. The mask is drawn in the sharp layer's
// own box, narrower than the footer and centred in it, so the cursor is measured against that layer
// on every frame. At 1280, 1440 and 1920 the focus is under the cursor on the left, in the middle
// and on the right, after the page scrolled under a still cursor and after a resize; leaving eases
// back with a transition, never a jump; touch input and a reader who asks for less motion are not
// followed.
type FocusState = {
  manual: boolean;
  dx: number;
  dy: number;
  mix: number;
  gliding: boolean;
};
function focusState(page: Page, x: number, y: number): Promise<FocusState> {
  return page.evaluate(
    ([clientX, clientY]) => {
      const root = document.querySelector<HTMLElement>('[data-testid="wordmark-focus"]');
      const layer = root?.querySelector<HTMLElement>(".sh");
      if (!root || !layer) throw new Error("no wordmark");
      const rect = layer.getBoundingClientRect();
      const style = getComputedStyle(root);
      return {
        manual: root.classList.contains("man"),
        // How far the focus is from the cursor, in the layer's pixels.
        dx: parseFloat(root.style.getPropertyValue("--fx")) - ((clientX ?? 0) - rect.left),
        dy: parseFloat(root.style.getPropertyValue("--fy")) - ((clientY ?? 0) - rect.top),
        mix: Number(style.getPropertyValue("--wm")),
        gliding: style.animationName.includes("landing-wmL"),
      };
    },
    [x, y],
  );
}

test("the footer wordmark's focus sits under the cursor at 1280, 1440 and 1920, after a scroll and a resize, and eases back", async ({
  page,
}) => {
  const problems = watchConsole(page);
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const mark = page.getByTestId("wordmark-focus");
    await mark.scrollIntoViewIfNeeded();
    const before = await focusState(page, 0, 0);
    expect(before).toMatchObject({ manual: false, mix: 0, gliding: true });

    const under = async (x: number, y: number, when: string) => {
      await expect
        .poll(async () => {
          const state = await focusState(page, x, y);
          return state.manual && Math.abs(state.dx) <= 1 && Math.abs(state.dy) <= 1;
        }, `${width}: the focus under the cursor ${when}`)
        .toBe(true);
    };
    const box = async () => {
      const found = await mark.boundingBox();
      if (!found) throw new Error("the wordmark has no box");
      return found;
    };
    let area = await box();
    // The layer is narrower than the footer: the left and right points lie outside it, over the
    // footer's sky, where the old code was furthest off.
    for (const [part, name] of [
      [0.08, "at the left"],
      [0.5, "in the middle"],
      [0.92, "at the right"],
    ] as const) {
      const x = Math.round(area.x + area.width * part);
      const y = Math.round(area.y + area.height * 0.55);
      await page.mouse.move(x, y, { steps: 4 });
      await under(x, y, name);
    }
    // The eased mix reaches the cursor.
    await expect.poll(async () => (await focusState(page, 0, 0)).mix).toBe(1);

    // The page scrolls under a cursor that does not move.
    const still = {
      x: Math.round(area.x + area.width * 0.3),
      y: Math.round(area.y + area.height * 0.5),
    };
    await page.mouse.move(still.x, still.y);
    await under(still.x, still.y, "before the scroll");
    await page.evaluate(() => window.scrollBy(0, -70));
    await expect.poll(async () => (await box()).y).not.toBe(area.y);
    await under(still.x, still.y, "after the scroll");

    // A resize moves and scales the layer; the next move is measured against it as it is now.
    await page.setViewportSize({ width: width - 180, height: 820 });
    await mark.scrollIntoViewIfNeeded();
    area = await box();
    const moved = {
      x: Math.round(area.x + area.width * 0.7),
      y: Math.round(area.y + area.height * 0.5),
    };
    await page.mouse.move(moved.x, moved.y, { steps: 3 });
    await under(moved.x, moved.y, "after the resize");

    // Leaving: the mix starts back from where it was, through a transition, and ends at the glide.
    await expect.poll(async () => (await focusState(page, 0, 0)).mix).toBe(1);
    const left = await page.evaluate(async () => {
      const root = document.querySelector<HTMLElement>('[data-testid="wordmark-focus"]');
      if (!root) throw new Error("no wordmark");
      root.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
      const first = Number(getComputedStyle(root).getPropertyValue("--wm"));
      const easing = root
        .getAnimations()
        .filter(
          (animation) =>
            animation instanceof CSSTransition && animation.transitionProperty === "--wm",
        );
      await Promise.all(easing.map((animation) => animation.finished));
      return {
        manual: root.classList.contains("man"),
        first,
        transitions: easing.length,
        last: Number(getComputedStyle(root).getPropertyValue("--wm")),
      };
    });
    expect(left.manual).toBe(false);
    expect(left.transitions).toBe(1);
    expect(left.first).toBeGreaterThan(0.9);
    expect(left.last).toBe(0);
    expect((await focusState(page, 0, 0)).gliding).toBe(true);
  }
  expect(problems).toEqual([]);
});

test("the footer wordmark does not follow touch input or a reader who asks for less motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const mark = page.getByTestId("wordmark-focus");
  await mark.scrollIntoViewIfNeeded();
  const area = await mark.boundingBox();
  if (!area) throw new Error("the wordmark has no box");
  const x = Math.round(area.x + area.width / 2);
  const y = Math.round(area.y + area.height / 2);
  const settle = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );

  // A finger and a pen: nothing follows them, and the glide goes on.
  for (const pointerType of ["touch", "pen"]) {
    await page.evaluate(
      ([clientX, clientY, type]) => {
        document.querySelector('[data-testid="wordmark-focus"]')?.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerType: type as string,
            clientX: clientX as number,
            clientY: clientY as number,
            bubbles: true,
          }),
        );
      },
      [x, y, pointerType],
    );
    await settle();
    expect(await focusState(page, x, y)).toMatchObject({ manual: false, mix: 0, gliding: true });
  }

  // Less motion: no glide, no tracking; the focus holds still where the design puts it.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(x, y, { steps: 3 });
  await settle();
  expect(await focusState(page, x, y)).toMatchObject({ manual: false, mix: 0, gliding: false });
});
