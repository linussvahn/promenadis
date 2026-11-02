export const participationStates = [
  "pending",
  "waitlisted",
  "approved",
  "withdrawn",
  "rejected",
  "suspended",
  "revoked",
  "pending_address_change",
  "pending_reschedule_confirmation",
] as const;

export type ParticipationState = (typeof participationStates)[number];

const transitions = {
  pending: ["approved", "waitlisted", "rejected", "withdrawn"],
  waitlisted: ["approved", "rejected", "withdrawn"],
  approved: [
    "withdrawn",
    "revoked",
    "suspended",
    "pending_address_change",
    "pending_reschedule_confirmation",
  ],
  suspended: ["approved", "withdrawn", "revoked"],
  pending_address_change: ["approved", "withdrawn", "revoked"],
  pending_reschedule_confirmation: ["approved", "withdrawn"],
  withdrawn: [],
  rejected: [],
  revoked: [],
} as const satisfies Record<ParticipationState, readonly ParticipationState[]>;

export function canTransitionParticipation(
  from: ParticipationState,
  to: ParticipationState,
): boolean {
  return (transitions[from] as readonly ParticipationState[]).includes(to);
}

// Suspension and address review keep the seller's place; withdrawal and
// revocation free it.
export function consumesSellerPlace(state: ParticipationState): boolean {
  return state === "approved" || state === "suspended" || state === "pending_address_change";
}

export type AdmissionMode = "auto_inside" | "host_approval" | "invite_only";

// Initial state for a new application, matching apply_to_event_command.
export function initialParticipationState(input: {
  readonly admissionMode: AdmissionMode;
  readonly insideBoundary: boolean;
  readonly placesAvailable: boolean;
}): "approved" | "waitlisted" | "pending" {
  if (input.admissionMode === "invite_only") throw new Error("Event is invite-only");
  if (input.admissionMode === "auto_inside" && input.insideBoundary) {
    return input.placesAvailable ? "approved" : "waitlisted";
  }
  return "pending";
}
