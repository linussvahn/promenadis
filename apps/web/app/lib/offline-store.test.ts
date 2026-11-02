import { describe, expect, it } from "vitest";
import { isUsable, OFFLINE_BUDGET_BYTES, planEviction } from "./offline-store";

const mib = 1024 * 1024;

describe("offline budget", () => {
  it("evicts least recently used events but never the active walk", () => {
    const entries = [
      { bytes: 20 * mib, eventKey: "old", lastUsedAt: 1, pinned: false },
      { bytes: 20 * mib, eventKey: "walking", lastUsedAt: 0, pinned: true },
      { bytes: 5 * mib, eventKey: "recent", lastUsedAt: 5, pinned: false },
    ];
    expect(planEviction(entries, { bytes: 10 * mib, eventKey: "new" })).toEqual({
      evict: ["old"],
      fits: true,
    });
    expect(planEviction(entries, { bytes: 40 * mib, eventKey: "new" })).toEqual({
      evict: ["old", "recent"],
      fits: false,
    });
    expect(OFFLINE_BUDGET_BYTES).toBe(50 * mib);
  });

  it("replaces an event's own copy without counting it twice", () => {
    const entries = [{ bytes: 45 * mib, eventKey: "same", lastUsedAt: 1, pinned: true }];
    expect(planEviction(entries, { bytes: 46 * mib, eventKey: "same" }).fits).toBe(true);
  });

  it("refuses expired copies", () => {
    expect(isUsable({ expiresAt: new Date(Date.now() - 1).toISOString() })).toBe(false);
    expect(isUsable({ expiresAt: new Date(Date.now() + 60_000).toISOString() })).toBe(true);
  });
});
