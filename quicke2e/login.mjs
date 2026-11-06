// Signs in and saves the browser session to auth.json next to this file (gitignored: it is a live session).
// Credentials come from the environment, never from a file in the repo.
import { chromium } from "@playwright/test";

const base = process.env.APP_BASE ?? "http://localhost:3000";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(`${base}/sign-in`);
await p.getByLabel("Email").fill(process.env.TEST_EMAIL);
await p.getByLabel("Password", { exact: true }).fill(process.env.TEST_PASSWORD);
await p.getByRole("button", { name: /sign in/i }).click();
await p.waitForURL((u) => !u.pathname.includes("sign-in"));
await p.context().storageState({ path: new URL("./auth.json", import.meta.url).pathname });
await b.close();
