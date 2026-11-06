// Revokes the keys the flows made, and no others, then prints what the list shows on a fresh load.
import { chromium } from "@playwright/test";

const b = await chromium.launch();
const ctx = await b.newContext({ storageState: new URL("./auth.json", import.meta.url).pathname });
const p = await ctx.newPage();
await p.goto(`${process.env.APP_BASE ?? "http://localhost:3000"}/settings/developers`);
await p.getByRole("heading", { name: "Developers" }).waitFor();
console.log("before cleanup:", await p.getByTestId("key-row").locator("span.truncate").allInnerTexts());

const ours = /^(Alpha agent|Bravo agent|Keep agent|Boundary name) |^<img src=x onerror=alert\(1\)>$|^Bob'\); DROP TABLE apikey;--$/;
for (;;) {
  const names = await p.getByTestId("key-row").locator("span.truncate").allInnerTexts();
  const name = names.find((n) => ours.test(n));
  if (!name) break;
  const before = names.length;
  await p.getByRole("button", { name: `Revoke ${name}`, exact: true }).first().click();
  await p.getByRole("button", { name: "Revoke", exact: true }).click();
  await p.waitForFunction((n) => document.querySelectorAll('[data-testid="key-row"]').length < n, before);
}
await p.reload();
await p.getByRole("heading", { name: "Developers" }).waitFor();
console.log("after cleanup:", await p.getByTestId("key-row").locator("span.truncate").allInnerTexts());
await b.close();
