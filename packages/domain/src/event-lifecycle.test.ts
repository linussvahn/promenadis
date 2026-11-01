import { describe, expect, it } from "vitest";
import { assertEventTransition, canTransitionEvent } from "./event-lifecycle";

describe("event lifecycle", () => {
  it("allows a draft to be published", () => {
    expect(canTransitionEvent("draft", "published")).toBe(true);
  });

  it("deletes drafts instead of modelling deletion as cancellation", () => {
    expect(canTransitionEvent("draft", "cancelled")).toBe(false);
  });

  it("does not let an archived event become public again", () => {
    expect(canTransitionEvent("archived", "published")).toBe(false);
    expect(() => assertEventTransition("archived", "published")).toThrow(
      "Event transition archived -> published is not allowed",
    );
  });

  it("models postponement as an explicit safety transition", () => {
    expect(canTransitionEvent("active", "postponed")).toBe(true);
    expect(canTransitionEvent("postponed", "active")).toBe(false);
  });

  it("ends an active event instead of cancelling it", () => {
    expect(canTransitionEvent("active", "ended")).toBe(true);
    expect(canTransitionEvent("active", "cancelled")).toBe(false);
  });
});
