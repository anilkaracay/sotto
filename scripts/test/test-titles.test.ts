// The AC checker's title extraction: only the first argument of test, it and describe calls counts.
import { describe, expect, it } from "vitest";
import { testTitles } from "../checks/test-titles.ts";

describe("test titles for the AC checker", () => {
  it("reads the titles of Vitest and Playwright calls, chained forms included", () => {
    const source = `
      describe("AC-01.1 sign in", () => {
        it("AC-01.2 refuses a replay", async () => {});
        it.skip("AC-01.3 skipped", () => {});
        it(
          "AC-02.1 on a new line",
          () => {},
        );
      });
      describe.skipIf(!process.env.X)("AC-02.3 on localnet", () => {});
      test("AC-03.2 unlocks (AC-02.2 too)", async ({ page }) => {});
      test.describe.serial("AC-04.1 serial", () => {});
      it.each([1, 2])("AC-04.2 case %s", () => {});
      test(\`AC-05.1 template \${1 + 1}\`, () => {});
      test("AC-06.1 " + "joined", () => {});
    `;
    expect(testTitles("x.test.ts", source)).toEqual([
      "AC-01.1 sign in",
      "AC-01.2 refuses a replay",
      "AC-01.3 skipped",
      "AC-02.1 on a new line",
      "AC-02.3 on localnet",
      "AC-03.2 unlocks (AC-02.2 too)",
      "AC-04.1 serial",
      "AC-04.2 case %s",
      "AC-05.1 template ${1 + 1}",
      "AC-06.1 joined",
    ]);
  });

  it("ignores comments, other strings and calls that are not tests", () => {
    const source = `
      // it("AC-07.1 in a line comment", () => {});
      /* describe("AC-07.2 in a block comment", () => {}); */
      /** The Locked state for AC-07.3 comes later. */
      const note = "AC-07.4 in a string";
      expect(value).toBe("AC-07.5 in an assertion");
      if (/AC-07\\.6/.test(note)) console.log(note);
      helper.it("AC-07.7 not a test function");
      it(title, () => {});
      it("plain title", () => {
        // AC-07.8 inside a test body
      });
    `;
    expect(testTitles("y.spec.ts", source)).toEqual(["plain title"]);
  });

  it("parses TSX", () => {
    const source = `it("AC-08.1 renders", () => { render(<Page title="AC-08.2" />); });`;
    expect(testTitles("z.test.tsx", source)).toEqual(["AC-08.1 renders"]);
  });
});
