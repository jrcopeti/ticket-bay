// GENERATED from a passed exploratory run -- do not hand-edit; regenerate.
// flow: attack-signed-out-is-sent-to-sign-in   engine: local   outcome: DONE_VERIFIED   0 steps in 1017 ms
// Every locator below is an ACCESSIBLE NAME. A rename in the app breaks this spec --
// that is the intended signal, not a defect: run quicke2e again to re-explore the flow.
import { test, expect } from "@playwright/test";

const BASE = (process.env.APP_BASE ?? "http://localhost:3000").replace(/\/$/, "");
const INPUTS = {
};

test("attack-signed-out-is-sent-to-sign-in", async ({ page }) => {
  const serverErrors = [];
  page.on("response", (r) => { try { if (r.status() >= 500 && ["document", "fetch", "xhr"].includes(r.request().resourceType()) && new URL(r.url()).origin === new URL(BASE).origin) serverErrors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); } catch {} });
  await page.goto(BASE + "/settings/developers");

  // ---- the assertion. This, not the steps, is the test.
  await expect(page).toHaveURL(new RegExp("/sign-in"), { timeout: 5000 });
  expect(serverErrors, "server errors (HTTP 5xx) during the flow").toEqual([]);
});
