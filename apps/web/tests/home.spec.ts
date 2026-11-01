import { expect, test } from "@playwright/test";

test("bilingual mobile shell is keyboard-operable", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upptäck kvarteret till fots.");
  await page.getByRole("button", { name: /English/u }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Discover the neighbourhood on foot.",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Discover the neighbourhood on foot.",
  );

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
});

test("publishes an installable manifest and offline fallback", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  await expect(manifest.json()).resolves.toMatchObject({
    display: "standalone",
    id: "/",
    scope: "/",
    start_url: "/",
  });

  const offline = await request.get("/offline.html");
  expect(offline.ok()).toBeTruthy();
  expect(await offline.text()).toContain("Du är offline");
});

test("offers the bilingual passwordless sign-in entry point", async ({ page }) => {
  await page.goto("/sign-in");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Logga in utan lösenord");
  await page.getByRole("button", { name: /English/u }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in without a password");
});
