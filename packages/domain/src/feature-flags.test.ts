import { describe, expect, it } from "vitest";
import { capabilityKeys, capabilityRegistry, isCapabilityEnabled } from "./feature-flags";

describe("capability registry", () => {
  it("fails closed when configuration is missing", () => {
    for (const key of capabilityKeys) {
      expect(capabilityRegistry[key].safeDefault).toBe(false);
      expect(isCapabilityEnabled(key, undefined)).toBe(false);
    }
  });

  it("does not include protective takedown or event-end commands", () => {
    expect(capabilityKeys).not.toContain("safetyTakedown");
    expect(capabilityKeys).not.toContain("eventEnd");
  });
});
