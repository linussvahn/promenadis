// Local only: proves a walk started on the first visit survives an offline
// reload of the production build (service-worker shell, page and asset
// caches plus the IndexedDB event copy). Reseeds the synthetic demo event,
// builds, serves the build on :4173 and drives Chromium.
import { execFileSync, spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (args) => execFileSync("pnpm", args, { cwd: webRoot, encoding: "utf8" });

console.log("Seeding the demo event and building…");
const seeded = run(["demo:seed"]);
const key = /\/e\/([0-9a-f]{32})\/map/u.exec(seeded)?.[1];
if (!key) throw new Error(`Demo seed printed no event key:\n${seeded}`);
run(["build"]);

const server = spawn("node", ["scripts/serve-local-production.mjs"], {
  cwd: webRoot,
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((ready, fail) => {
  server.stdout.on("data", (chunk) => {
    if (String(chunk).includes("Production build on")) ready();
  });
  server.on("exit", (code) => fail(new Error(`Server exited with ${code}`)));
});
// The proxy listens before the app behind it does; wait for a real page.
for (let attempt = 0; ; attempt += 1) {
  const response = await fetch("http://127.0.0.1:4173/").catch(() => null);
  if (response?.ok) break;
  if (attempt > 100) throw new Error("The production build never answered.");
  await new Promise((settle) => setTimeout(settle, 200));
}

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
  console.log(`${condition ? "ok" : "FAIL"} - ${message}`);
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ locale: "sv-SE" });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => console.log(`page error: ${error.message}`));
  await page.goto(`http://127.0.0.1:4173/e/${key}/map`);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 20_000,
  });
  check(true, "the first visit is controlled by the service worker");

  const addToWalk = page.getByLabel("Lägg till i promenaden");
  await addToWalk.first().waitFor();
  await addToWalk.nth(0).check();
  await addToWalk.nth(1).check();
  await page.getByRole("button", { name: "Planera promenaden" }).click();
  const planner = page.getByRole("region", { name: "Planera en promenad" });
  await planner.getByRole("button", { name: "Starta promenaden" }).click();
  await planner.getByRole("button", { name: "Markera besökt" }).first().click();
  // Give the worker time to copy what loaded before it took control.
  await page.waitForFunction(
    async () => (await (await caches.open("promenadis-pages-v3")).keys()).length > 0,
    null,
    { timeout: 20_000 },
  );

  await context.setOffline(true);
  const failed = [];
  page.on("requestfailed", (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith("/api/")) failed.push(path);
  });
  await page.reload();
  check(
    (await page.title()).includes("Karta"),
    "the offline reload shows the event map, not the offline page",
  );
  await page.getByText(/Du är offline/u).waitFor({ timeout: 20_000 });
  check(true, "the offline banner names the saved copy");
  await page
    .getByRole("region", { name: "Planera en promenad" })
    .getByText(/· Besökt/u)
    .waitFor({ timeout: 10_000 });
  check(true, "the started walk and its progress survive");
  check(failed.length === 0, `no shell or asset request fails offline (${failed.join(", ")})`);

  await context.setOffline(false);
  await page.getByText(/Du är offline/u).waitFor({ state: "detached", timeout: 20_000 });
  check(true, "reconnecting clears the offline banner");
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

if (failures.length) {
  console.error(`${failures.length} offline check(s) failed.`);
  process.exit(1);
}
console.log("Production offline reload checks passed.");
