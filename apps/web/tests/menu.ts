import { expect, type Page } from "@playwright/test";

/**
 * On phones the menu (navigation, language, theme) sits behind a button.
 * A tap before hydration does nothing, so keep tapping until it opens.
 */
export async function openMenu(page: Page) {
  const toggle = page.getByRole("button", { name: /^(Meny|Menu)$/u });
  if (!(await toggle.isVisible())) return;
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
