// The network banner for the design pass (step 3.6, 13 A52): the node job's web server has no validator
// to reach, so every /app page shows "Network unreachable, retrying". The admin console shows it here,
// checked for its words and saved as a full page screenshot at 1440 to this test's output directory
// and, once it passes, to .demo-shots/screens/<UTC time>-node/ (git ignored), for the founder's
// approval. The paused proof program banner is in the localnet sharing screens spec.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { e2eKeypair } from "../fixtures.ts";
import { ANY_APP_PAGE, signIn } from "../helpers.ts";
import { expectVisual } from "../visual.ts";

const DEMO_SHOTS = fileURLToPath(new URL("../../../.demo-shots/screens/", import.meta.url));

test("the network banner on an app page when the network cannot be reached (13 A52)", async ({
  page,
}) => {
  await signIn(page, e2eKeypair(), ANY_APP_PAGE);
  await page.goto("/app/admin");
  const banner = page.getByTestId("network-unreachable");
  await expect(banner).toContainText("Network unreachable, retrying");
  await expect(banner).toContainText("This page tries again every 15 seconds.");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const path = test.info().outputPath("37-banner-unreachable.png");
  await page.screenshot({ path, fullPage: true });
  // Step 3.8: the approved banner against its baseline.
  await expectVisual(page, "37-banner-unreachable");
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const folder = `${DEMO_SHOTS}${stamp}Z-node`;
  await mkdir(folder, { recursive: true });
  await copyFile(path, `${folder}/37-banner-unreachable.png`);
});
