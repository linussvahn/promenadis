import { expect, test } from "@playwright/test";

test("theme follows the device and persists an explicit override", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (/hydrat/iu.test(message.text())) hydrationErrors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const theme = page.getByRole("combobox", { name: "Färgtema" });
  await expect(theme).toHaveValue("system");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(27, 23, 20)");
  await theme.selectOption("light");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(251, 245, 234)");
  await page.reload();
  await expect(theme).toHaveValue("light");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(251, 245, 234)");
  await theme.selectOption("dark");
  await page.goto("/sign-in");
  await expect(theme).toHaveValue("dark");
  await expect(page.getByRole("textbox", { name: /e-post/iu })).toHaveCSS(
    "background-color",
    "rgb(31, 26, 22)",
  );
  await theme.selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(251, 245, 234)");
  expect(hydrationErrors).toEqual([]);
});

test("theme works when local storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Färgtema" }).selectOption("dark");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(27, 23, 20)");
});
