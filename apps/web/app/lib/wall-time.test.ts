import { describe, expect, it } from "vitest";
import { toDateTimeLocal, wallTimeToIso } from "./wall-time";

const zone = "Europe/Stockholm";

describe("wall times across daylight-saving changes", () => {
  it("round-trips ordinary summer and winter times", () => {
    expect(wallTimeToIso("2031-06-14T10:00", zone)).toBe("2031-06-14T08:00:00.000Z");
    expect(wallTimeToIso("2031-12-14T10:00", zone)).toBe("2031-12-14T09:00:00.000Z");
    expect(toDateTimeLocal("2031-06-14T08:00:00.000Z", zone)).toBe("2031-06-14T10:00");
  });

  it("keeps an event spanning the autumn change at its real length", () => {
    const start = Date.parse(wallTimeToIso("2031-10-26T00:00", zone));
    const end = Date.parse(wallTimeToIso("2031-10-26T06:00", zone));
    // Six wall-clock hours across the fall-back are seven real hours.
    expect((end - start) / 3_600_000).toBe(7);
  });

  it("resolves a wall time inside the spring gap to a real instant after it", () => {
    const iso = wallTimeToIso("2031-03-30T02:30", zone);
    expect(toDateTimeLocal(iso, zone)).toMatch(/^2031-03-30T0[13]:30$/u);
    expect(Number.isNaN(Date.parse(iso))).toBe(false);
  });

  it("refuses malformed input", () => {
    expect(() => wallTimeToIso("2031-03-30 02:30", zone)).toThrow("invalid_wall_time");
  });
});
