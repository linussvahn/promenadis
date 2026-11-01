export const capabilityKeys = [
  "eventPublication",
  "newRegistrations",
  "sellerApplications",
  "exports",
  "organizerRelay",
  "outboundEmail",
  "graphBuilds",
] as const;

export type CapabilityKey = (typeof capabilityKeys)[number];

export interface CapabilityDefinition {
  readonly key: CapabilityKey;
  readonly safeDefault: false;
  readonly protects: "read" | "write" | "provider-call";
  readonly owner: "platform";
}

export const capabilityRegistry = Object.freeze(
  Object.fromEntries(
    capabilityKeys.map((key): [CapabilityKey, CapabilityDefinition] => [
      key,
      {
        key,
        owner: "platform",
        protects: key === "outboundEmail" || key === "graphBuilds" ? "provider-call" : "write",
        safeDefault: false,
      },
    ]),
  ) as Record<CapabilityKey, CapabilityDefinition>,
);

export function isCapabilityEnabled(
  key: CapabilityKey,
  configuredValue: boolean | undefined,
): boolean {
  return configuredValue ?? capabilityRegistry[key].safeDefault;
}
