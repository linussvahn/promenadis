import { describe, expect, it } from "vitest";
import {
  canTransitionParticipation,
  consumesSellerPlace,
  initialParticipationState,
  participationStates,
} from "./seller-admission";

describe("seller admission", () => {
  it("auto-approves inside the boundary until places run out", () => {
    const base = { admissionMode: "auto_inside", insideBoundary: true } as const;
    expect(initialParticipationState({ ...base, placesAvailable: true })).toBe("approved");
    expect(initialParticipationState({ ...base, placesAvailable: false })).toBe("waitlisted");
  });

  it("sends geographic exceptions and manual events to the host", () => {
    expect(
      initialParticipationState({
        admissionMode: "auto_inside",
        insideBoundary: false,
        placesAvailable: true,
      }),
    ).toBe("pending");
    expect(
      initialParticipationState({
        admissionMode: "host_approval",
        insideBoundary: true,
        placesAvailable: true,
      }),
    ).toBe("pending");
    expect(() =>
      initialParticipationState({
        admissionMode: "invite_only",
        insideBoundary: true,
        placesAvailable: true,
      }),
    ).toThrow("invite-only");
  });

  it("counts only approved, suspended and address-review sellers against places", () => {
    expect(participationStates.filter(consumesSellerPlace)).toEqual([
      "approved",
      "suspended",
      "pending_address_change",
    ]);
  });

  it("never reopens a closed participation", () => {
    for (const closed of ["withdrawn", "rejected", "revoked"] as const) {
      for (const next of participationStates) {
        expect(canTransitionParticipation(closed, next)).toBe(false);
      }
    }
    expect(canTransitionParticipation("waitlisted", "approved")).toBe(true);
    expect(canTransitionParticipation("approved", "waitlisted")).toBe(false);
  });
});
