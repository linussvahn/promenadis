import { describe, expect, it } from "vitest";
import { formatCurrency, formatDateTime, isLocale, translate } from "./index";

describe("localization primitives", () => {
  it("keeps Swedish and English catalogs complete", () => {
    expect(translate("sv", "home.title")).toBe("Upptäck kvarteret till fots.");
    expect(translate("en", "home.title")).toBe("Discover the neighbourhood on foot.");
  });

  it("validates only supported locales", () => {
    expect(isLocale("sv")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("de")).toBe(false);
  });

  it("formats time in an explicit event time zone", () => {
    const value = "2026-10-25T01:30:00Z";
    expect(formatDateTime("en", value, "Europe/Stockholm")).toContain("02:30");
  });

  it("formats integer minor units as currency", () => {
    expect(formatCurrency("en", 12_500, "SEK")).toContain("125.00");
  });
});
