export const eventStates = [
  "draft",
  "published",
  "active",
  "postponed",
  "ended",
  "cancelled",
  "archived",
] as const;

export type EventState = (typeof eventStates)[number];

const transitions = {
  draft: ["published"],
  published: ["active", "postponed", "cancelled"],
  active: ["ended", "postponed"],
  postponed: ["published", "cancelled"],
  ended: ["archived"],
  cancelled: ["archived"],
  archived: [],
} as const satisfies Record<EventState, readonly EventState[]>;

export function canTransitionEvent(from: EventState, to: EventState): boolean {
  return (transitions[from] as readonly EventState[]).includes(to);
}

export function assertEventTransition(from: EventState, to: EventState): void {
  if (!canTransitionEvent(from, to)) {
    throw new Error(`Event transition ${from} -> ${to} is not allowed`);
  }
}
