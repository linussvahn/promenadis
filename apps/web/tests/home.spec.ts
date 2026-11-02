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

test("scripts run only from this origin or with the response nonce", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/u.test(message.text())) violations.push(message.text());
  });
  const first = await page.goto("/");
  const policy = first?.headers()["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/u.exec(policy)?.[1];
  expect(nonce).toBeTruthy();
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).not.toContain("unsafe-inline");
  expect(policy).not.toContain("unsafe-eval");
  // Hydrated: the page's own inline scripts carried the nonce.
  await expect(page.getByRole("button", { name: /English/u })).toBeEnabled();
  expect(violations).toEqual([]);

  // A fresh nonce per response.
  const second = await page.reload();
  expect(second?.headers()["content-security-policy"]).not.toContain(`'nonce-${nonce}'`);

  // Injected inline scripts and handler attributes are refused.
  const ran = await page.evaluate(async () => {
    const flags = window as unknown as Record<string, boolean>;
    const script = document.createElement("script");
    script.textContent = "window.__injected = true";
    document.body.append(script);
    const image = document.createElement("img");
    image.setAttribute("onerror", "window.__handler = true");
    image.src = "data:,";
    document.body.append(image);
    await new Promise((settle) => setTimeout(settle, 200));
    return { handler: Boolean(flags.__handler), injected: Boolean(flags.__injected) };
  });
  expect(ran).toEqual({ handler: false, injected: false });
});
