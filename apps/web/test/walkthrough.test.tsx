// The walkthrough (step 4.8, D-35): the page names each of Sotto's controls by the label its screen
// shows, so a label the walkthrough names must be in the source of that screen; the page shows every
// step with a picture that exists; the first-run card and the demo banner link to it; and the
// README's section carries the same steps and labels. Nothing public says who the walkthrough is for.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  WALKTHROUGH_LABELS,
  WALKTHROUGH_LINK,
  WALKTHROUGH_PATH,
  WALKTHROUGH_STEPS,
  WALKTHROUGH_TITLE,
  WALKTHROUGH_WALLETS,
} from "../lib/walkthrough.ts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
  usePathname: () => "/demo",
}));

const WEB = fileURLToPath(new URL("../", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const source = (file: string) => readFileSync(`${WEB}${file}`, "utf8");
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

const { default: WalkthroughPage } = await import("../app/app/walkthrough/page.tsx");
const page = renderToStaticMarkup(<WalkthroughPage />);

describe("the walkthrough (step 4.8)", () => {
  it("names each control by the label its screen shows", () => {
    for (const [name, entry] of Object.entries(WALKTHROUGH_LABELS)) {
      expect(source(entry.file), `${name}: ${entry.find} in ${entry.file}`).toContain(entry.find);
    }
  });

  it("shows every step in order, each with a picture that exists, and every label it names", () => {
    const words = text(page);
    expect(words).toContain(WALKTHROUGH_TITLE);
    let at = -1;
    for (const title of WALKTHROUGH_STEPS) {
      const next = words.indexOf(title, at + 1);
      expect(next, title).toBeGreaterThan(at);
      at = next;
    }
    expect(page.match(/data-testid="walkthrough-step"/g)).toHaveLength(WALKTHROUGH_STEPS.length);
    for (const section of page.split('data-testid="walkthrough-step"').slice(1)) {
      expect(section).toContain("<img");
    }
    const pictures = [...page.matchAll(/<img[^>]*src="(\/walkthrough\/[a-z-]+\.webp)"[^>]*>/g)];
    expect(pictures.length).toBeGreaterThanOrEqual(WALKTHROUGH_STEPS.length);
    for (const [tag, src] of pictures) {
      expect(existsSync(`${WEB}public${src}`), src).toBe(true);
      expect(tag).toMatch(/alt="[^"]{20,}"/);
      expect(tag).toMatch(/width="\d+" height="\d+"/);
    }
    for (const [name, entry] of Object.entries(WALKTHROUGH_LABELS)) {
      // The demo entry is a link in the page's own sentence, in lower case.
      const label = name === "demoEntry" ? entry.label.toLowerCase() : entry.label;
      expect(words, name).toContain(label);
    }
    for (const wallet of Object.values(WALKTHROUGH_WALLETS)) {
      for (const word of Object.values(wallet)) expect(words).toContain(word);
    }
  });

  it("is linked from the first-run card and from the demo banner", async () => {
    expect(WALKTHROUGH_PATH).toBe("/app/walkthrough");
    const card = source("app/app/[org]/overview/first-run-card.tsx");
    expect(card).toContain("href={WALKTHROUGH_PATH}");
    expect(card).toContain('data-testid="first-run-walkthrough"');
    const { DemoShell } = await import("../app/demo/_components/demo-shell.tsx");
    const banner = renderToStaticMarkup(
      <DemoShell orgName="Northwind Labs" current="picker">
        <p>inside</p>
      </DemoShell>,
    );
    const link = /<a[^>]*data-testid="demo-walkthrough"[^>]*>([^<]*)<\/a>/.exec(banner);
    expect(link?.[0]).toContain(`href="${WALKTHROUGH_PATH}"`);
    expect(link?.[1]).toBe(WALKTHROUGH_LINK);
  });

  it("is in the README with the same steps, labels and pictures", () => {
    const readme = readFileSync(`${ROOT}README.md`, "utf8");
    const start = readme.indexOf("## Walkthrough");
    expect(start).toBeGreaterThan(-1);
    const section = readme.slice(start, readme.indexOf("\n## ", start + 1));
    expect(section).toContain(`https://sottoapp.xyz${WALKTHROUGH_PATH}`);
    for (const title of WALKTHROUGH_STEPS) expect(section, title).toContain(title);
    for (const [name, entry] of Object.entries(WALKTHROUGH_LABELS)) {
      if (name === "demoEntry") continue;
      expect(section, name).toContain(entry.label);
    }
    for (const [, src] of section.matchAll(
      /src="(apps\/web\/public\/walkthrough\/[a-z-]+\.webp)"/g,
    )) {
      expect(existsSync(`${ROOT}${src}`), src).toBe(true);
    }
    // What each wallet shows and asks for, in the same words as the page.
    for (const wallet of Object.values(WALKTHROUGH_WALLETS)) {
      for (const word of Object.values(wallet)) expect(section, word).toContain(word);
    }
    expect(section.match(/<img /g)?.length ?? 0).toBeGreaterThanOrEqual(WALKTHROUGH_STEPS.length);
  });

  it("says nowhere who it was written for", () => {
    const readme = readFileSync(`${ROOT}README.md`, "utf8");
    for (const words of [text(page), readme, source("lib/walkthrough.ts")]) {
      expect(words).not.toMatch(/\bjudg(e|es|ing)\b/i);
      expect(words).not.toMatch(/hackathon jur/i);
    }
  });
});
