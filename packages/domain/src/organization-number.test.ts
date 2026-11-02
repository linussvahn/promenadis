import { describe, expect, it } from "vitest";
import { normalizeOrganizationNumber } from "./organization-number";

describe("Swedish organization numbers", () => {
  it.each([
    ["556016-0680", "556016-0680"],
    ["5560160680", "556016-0680"],
    ["16556016-0680", "556016-0680"],
    [" 556016-0680 ", "556016-0680"],
  ])("accepts and normalizes %s", (input, expected) => {
    expect(normalizeOrganizationNumber(input)).toBe(expected);
  });
  it.each([
    "556016-0681",
    "55601606",
    "abcdef-ghij",
    "",
    // Personal identity numbers (month in digits 3-4) are never organizations.
    "811218-9876",
    "121212-1212",
  ])("rejects %j", (input) => {
    expect(normalizeOrganizationNumber(input)).toBeNull();
  });
});
