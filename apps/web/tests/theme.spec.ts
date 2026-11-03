import { expect, test } from "@playwright/test";
import { openMenu } from "./menu";

test("theme follows the device and persists an explicit override", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (/hydrat/iu.test(message.text())) hydrationErrors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await openMenu(page);
  const auto = page.getByRole("radio", { name: "Auto" });
  const light = page.getByRole("radio", { name: "Ljust" });
  const dark = page.getByRole("radio", { name: "Mörkt" });
  await expect(auto).toBeChecked();
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(17, 17, 19)");
  await light.check();
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(244, 244, 242)");
  await page.reload();
  await openMenu(page);
  await expect(light).toBeChecked();
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(244, 244, 242)");
  await dark.check();
  await page.goto("/sign-in");
  await openMenu(page);
  await expect(dark).toBeChecked();
  await expect(page.getByRole("textbox", { name: /e-post/iu })).toHaveCSS(
    "background-color",
    "rgb(27, 27, 30)",
  );
  await auto.check();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(244, 244, 242)");
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
  await openMenu(page);
  await page.getByRole("radio", { name: "Mörkt" }).check();
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(17, 17, 19)");
});
