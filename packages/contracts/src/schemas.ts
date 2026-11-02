import { z } from "zod";

const isoInstant = z.iso.datetime({ offset: true });
const opaqueUuid = z.uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const apiErrorSchema = z.strictObject({
  code: z.string().min(1).max(80),
  correlationId: opaqueUuid,
  message: z.string().min(1).max(240),
  schemaVersion: z.literal("1.0"),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const browserSessionResponseSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  session: z
    .strictObject({
      user: z.strictObject({ id: opaqueUuid, email: z.email() }),
    })
    .nullable(),
});
export type BrowserSession = z.infer<typeof browserSessionResponseSchema>["session"];
export const browserOtpStartSchema = z.strictObject({ email: z.email().max(320) });
export const browserOtpVerifySchema = z.strictObject({
  email: z.email().max(320),
  token: z.string().regex(/^[0-9]{6}$/u),
});
export const browserCallbackSchema = z.strictObject({ code: z.string().min(1).max(2048) });
export const browserAuthSuccessSchema = z.strictObject({
  ok: z.literal(true),
  schemaVersion: z.literal("1.0"),
});

export const readinessResponseSchema = z.strictObject({
  generatedAt: isoInstant,
  revision: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/u),
  schemaVersion: z.literal("1.0"),
  status: z.enum(["ok", "degraded"]),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const preferredLocaleSchema = z.enum(["sv", "en"]);
export const organizerTypeSchema = z.enum([
  "individual",
  "informal_group",
  "association",
  "company",
]);
export const eventVisibilitySchema = z.enum(["public", "unlisted"]);
export const eventStateSchema = z.enum([
  "draft",
  "published",
  "active",
  "postponed",
  "ended",
  "cancelled",
  "archived",
]);
export const eventTeamRoleSchema = z.enum(["owner", "co_host", "moderator"]);
export const invitedEventTeamRoleSchema = z.enum(["co_host", "moderator"]);

export type EventTeamRole = z.infer<typeof eventTeamRoleSchema>;
export type InvitedEventTeamRole = z.infer<typeof invitedEventTeamRoleSchema>;

export const accountProfileSchema = z.strictObject({
  accountId: opaqueUuid,
  displayName: z.string().trim().min(1).max(80).nullable(),
  preferredLocale: preferredLocaleSchema,
});

export type AccountProfile = z.infer<typeof accountProfileSchema>;

export const accountRecoveryStatusSchema = z.strictObject({
  active: z.boolean(),
  issuedAt: isoInstant.nullable(),
  pendingClaim: z
    .strictObject({
      emailVerified: z.boolean(),
      expiresAt: isoInstant,
      id: opaqueUuid,
      initiatedAt: isoInstant,
      newEmailMasked: z.string().min(5).max(320),
      readyAt: isoInstant,
    })
    .nullable()
    .optional(),
  rotatedAt: isoInstant.nullable(),
  version: z.number().int().nonnegative(),
});

export type AccountRecoveryStatus = z.infer<typeof accountRecoveryStatusSchema>;

export const organizerVerificationStatusSchema = z.strictObject({
  badge: z.boolean(),
  organizationNumber: z
    .string()
    .regex(/^[0-9]{6}-[0-9]{4}$/u)
    .nullable(),
  reason: z.string().max(500).nullable(),
  recheckDueAt: isoInstant.nullable(),
  registeredName: z.string().max(200).nullable(),
  status: z.enum(["none", "pending", "verified", "rejected", "revoked"]),
});

export type OrganizerVerificationStatus = z.infer<typeof organizerVerificationStatusSchema>;

const verificationControlMethodSchema = z.enum([
  "organization_email",
  "official_website",
  "official_contact",
]);

export const requestOrganizerVerificationSchema = z.strictObject({
  controlMethod: verificationControlMethodSchema,
  controlReference: z.string().trim().min(3).max(200),
  organizationNumber: z.string().trim().max(16),
});

export type RequestOrganizerVerificationRequest = z.infer<
  typeof requestOrganizerVerificationSchema
>;

export const organizerVerificationQueueItemSchema = z.strictObject({
  controlMethod: verificationControlMethodSchema,
  controlReference: z.string().max(200),
  displayName: z.string().max(100),
  organizationNumber: z.string().regex(/^[0-9]{6}-[0-9]{4}$/u),
  organizerProfileId: opaqueUuid,
  organizerType: organizerTypeSchema,
  ownOrganizer: z.boolean(),
  requestedAt: isoInstant,
  website: z.string().max(500).nullable(),
});

export const organizerVerificationQueueSchema = z
  .array(organizerVerificationQueueItemSchema)
  .max(500);

export type OrganizerVerificationQueueItem = z.infer<typeof organizerVerificationQueueItemSchema>;

export const decideOrganizerVerificationSchema = z.strictObject({
  controlConfirmed: z.boolean().optional(),
  decision: z.enum(["verified", "rejected", "revoked"]),
  reason: z.string().trim().max(500).optional(),
  registeredName: z.string().trim().max(200).optional(),
  registryActive: z.boolean().optional(),
});

export type DecideOrganizerVerificationRequest = z.infer<typeof decideOrganizerVerificationSchema>;

export const mfaStatusSchema = z.strictObject({
  assuranceLevel: z.enum(["aal1", "aal2"]),
  totpEnabled: z.boolean(),
});

export type MfaStatus = z.infer<typeof mfaStatusSchema>;

// Returned once at enrollment so an authenticator app can be set up. Never logged.
export const totpEnrollmentSchema = z.strictObject({
  factorId: opaqueUuid,
  qrCode: z.string().startsWith("data:image/svg+xml").max(600_000),
  secret: z.string().regex(/^[A-Z2-7]{16,64}$/u),
  uri: z.string().startsWith("otpauth://totp/").max(1_000),
});

export type TotpEnrollment = z.infer<typeof totpEnrollmentSchema>;

export const totpVerifyRequestSchema = z.strictObject({
  code: z.string().regex(/^[0-9]{6}$/u),
  factorId: opaqueUuid.optional(),
});

export type TotpVerifyRequest = z.infer<typeof totpVerifyRequestSchema>;

export const accountDeletionBlockerSchema = z.strictObject({
  id: opaqueUuid,
  kind: z.enum(["owned_event", "shared_organizer"]),
  state: eventStateSchema.nullable(),
  title: z.string().min(1).max(200),
});

export const accountDeletionStatusSchema = z.strictObject({
  blockers: z.array(accountDeletionBlockerSchema).max(500),
  eraseAfter: isoInstant.nullable(),
  pending: z.boolean(),
  requestedAt: isoInstant.nullable(),
});

export type AccountDeletionStatus = z.infer<typeof accountDeletionStatusSchema>;

export const requestAccountDeletionRequestSchema = z.strictObject({
  confirmationEmail: z.string().trim().min(3).max(320),
});

export type RequestAccountDeletionRequest = z.infer<typeof requestAccountDeletionRequestSchema>;

export const recoveryCodeEnrollmentResponseSchema = accountRecoveryStatusSchema.extend({
  code: z.string().regex(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){4}$/u),
});

export type RecoveryCodeEnrollmentResponse = z.infer<typeof recoveryCodeEnrollmentResponseSchema>;

export const accountRecoveryClaimSchema = z.strictObject({
  emailVerified: z.boolean(),
  expiresAt: isoInstant,
  id: opaqueUuid,
  initiatedAt: isoInstant,
  readyAt: isoInstant,
});

export type AccountRecoveryClaim = z.infer<typeof accountRecoveryClaimSchema>;

const recoveryEmailsSchema = {
  currentEmail: z.email().trim().max(320),
  newEmail: z.email().trim().max(320),
};

// Exactly one factor: the saved recovery code or a current authenticator code.
export const initiateAccountRecoveryRequestSchema = z.union([
  z.strictObject({
    ...recoveryEmailsSchema,
    recoveryCode: z.string().regex(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){4}$/u),
  }),
  z.strictObject({
    ...recoveryEmailsSchema,
    totpCode: z.string().regex(/^[0-9]{6}$/u),
  }),
]);

export const initiateAccountRecoveryResponseSchema = accountRecoveryClaimSchema.extend({
  delivery: z.literal("captured_locally"),
});

export const accountRecoveryTokenRequestSchema = z.strictObject({
  verificationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
});

// Never echoes the replacement address: the browser already knows it, and the
// response must stay safe to log as a state transition.
export const accountRecoveryCompletionSchema = z.strictObject({
  state: z.enum(["completed", "finishing"]),
});

export type AccountRecoveryCompletion = z.infer<typeof accountRecoveryCompletionSchema>;
export type InitiateAccountRecoveryRequest = z.infer<typeof initiateAccountRecoveryRequestSchema>;
export type AccountRecoveryTokenRequest = z.infer<typeof accountRecoveryTokenRequestSchema>;

export const organizerProfileSummarySchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100),
  id: opaqueUuid,
  locality: z.string().trim().min(1).max(100).nullable(),
  organizerType: organizerTypeSchema,
  role: z.enum(["owner", "manager"]),
  version: z.number().int().positive(),
  website: z.url().startsWith("https://").max(500).nullable(),
});

export type OrganizerProfileSummary = z.infer<typeof organizerProfileSummarySchema>;

export const eventIntervalSummarySchema = z.strictObject({
  endsAt: isoInstant,
  id: opaqueUuid,
  startsAt: isoInstant,
});

export type EventIntervalSummary = z.infer<typeof eventIntervalSummarySchema>;

export const boundaryPointSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

export type BoundaryPoint = z.infer<typeof boundaryPointSchema>;

export const eventBoundarySummarySchema = z.strictObject({
  areaSquareKilometers: z.number().finite().positive().max(25),
  displayLabel: z.string().trim().min(1).max(120).nullable(),
  ring: z.array(boundaryPointSchema).min(4).max(51),
  spanKilometers: z.number().finite().positive().max(10),
  version: z.number().int().positive(),
  warnings: z.array(z.enum(["area_near_limit", "span_near_limit"])).max(2),
});

export type EventBoundarySummary = z.infer<typeof eventBoundarySummarySchema>;

export const eventRegistrationSummarySchema = z.strictObject({
  allowDuringEvent: z.boolean(),
  closesAt: isoInstant,
  opensAt: isoInstant,
  version: z.number().int().positive(),
});

export type EventRegistrationSummary = z.infer<typeof eventRegistrationSummarySchema>;

export const eventControlSummarySchema = z.strictObject({
  id: opaqueUuid,
  state: eventStateSchema,
  version: z.number().int().positive(),
  visibility: eventVisibilitySchema,
});

export type EventControlSummary = z.infer<typeof eventControlSummarySchema>;

export const eventTeamMemberSummarySchema = z.strictObject({
  canReceiveOwnership: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(80),
  id: opaqueUuid,
  role: eventTeamRoleSchema,
});

export type EventTeamMemberSummary = z.infer<typeof eventTeamMemberSummarySchema>;

export const pendingEventTeamInviteSummarySchema = z.strictObject({
  email: z.email().max(320),
  expiresAt: isoInstant,
  id: opaqueUuid,
  role: invitedEventTeamRoleSchema,
});

export type PendingEventTeamInviteSummary = z.infer<typeof pendingEventTeamInviteSummarySchema>;

export const pendingEventOwnershipTransferSummarySchema = z.strictObject({
  expiresAt: isoInstant,
  id: opaqueUuid,
  organizerWillChange: z.boolean().optional(),
  targetOrganizerDisplayName: z.string().trim().min(1).max(100).optional(),
  toDisplayName: z.string().trim().min(1).max(80),
  toMembershipId: opaqueUuid,
});

export type PendingEventOwnershipTransferSummary = z.infer<
  typeof pendingEventOwnershipTransferSummarySchema
>;

export const ownershipTransferOptionSchema = z.strictObject({
  organizerDisplayName: z.string().trim().min(1).max(100),
  organizerProfileId: opaqueUuid,
  organizerWillChange: z.boolean(),
  recipientDisplayName: z.string().trim().min(1).max(80),
  toMembershipId: opaqueUuid,
});

export type OwnershipTransferOption = z.infer<typeof ownershipTransferOptionSchema>;

export const emergencySuccessorSummarySchema = z.strictObject({
  designatedAt: isoInstant,
  organizerDisplayName: z.string().trim().min(1).max(100),
  recipientDisplayName: z.string().trim().min(1).max(80),
  successorMembershipId: opaqueUuid,
  targetOrganizerProfileId: opaqueUuid,
});

export const emergencySuccessorOptionSchema = z.strictObject({
  organizerDisplayName: z.string().trim().min(1).max(100),
  organizerProfileId: opaqueUuid,
  recipientDisplayName: z.string().trim().min(1).max(80),
  successorMembershipId: opaqueUuid,
});

export const pendingEmergencySuccessorClaimSchema = z.strictObject({
  expiresAt: isoInstant,
  id: opaqueUuid,
  initiatedAt: isoInstant,
  readyAt: isoInstant,
  successorDisplayName: z.string().trim().min(1).max(80),
  successorMembershipId: opaqueUuid,
  targetOrganizerDisplayName: z.string().trim().min(1).max(100),
});

export type PendingEmergencySuccessorClaim = z.infer<typeof pendingEmergencySuccessorClaimSchema>;

export const eventTeamSummarySchema = z.strictObject({
  currentMembershipId: opaqueUuid.optional(),
  emergencySuccessor: emergencySuccessorSummarySchema.nullable().optional(),
  eventId: opaqueUuid,
  members: z.array(eventTeamMemberSummarySchema),
  ownershipTransferOptions: z.array(ownershipTransferOptionSchema).optional(),
  pendingEmergencyClaim: pendingEmergencySuccessorClaimSchema.nullable().optional(),
  pendingInvites: z.array(pendingEventTeamInviteSummarySchema),
  pendingTransfer: pendingEventOwnershipTransferSummarySchema.nullable().optional(),
  successorOptions: z.array(emergencySuccessorOptionSchema).optional(),
  teamVersion: z.number().int().positive(),
});

export type EventTeamSummary = z.infer<typeof eventTeamSummarySchema>;

export const incomingEventTeamInviteSummarySchema = z.strictObject({
  eventId: opaqueUuid,
  eventTitle: z.string().trim().min(1).max(120),
  expiresAt: isoInstant,
  id: opaqueUuid,
  organizerDisplayName: z.string().trim().min(1).max(100),
  role: invitedEventTeamRoleSchema,
});

export type IncomingEventTeamInviteSummary = z.infer<typeof incomingEventTeamInviteSummarySchema>;

export const draftEventSummarySchema = z.strictObject({
  boundary: eventBoundarySummarySchema.nullable(),
  description: z.string().max(2000),
  id: opaqueUuid,
  intervals: z.array(eventIntervalSummarySchema),
  organizerDisplayName: z.string().trim().min(1).max(100),
  organizerProfileId: opaqueUuid,
  registration: eventRegistrationSummarySchema.nullable(),
  role: z.enum(["owner", "co_host", "moderator"]),
  state: eventStateSchema,
  timezone: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(120),
  version: z.number().int().positive(),
  visibility: eventVisibilitySchema,
});

export type DraftEventSummary = z.infer<typeof draftEventSummarySchema>;

export const identityDashboardSchema = z.strictObject({
  events: z.array(draftEventSummarySchema),
  organizers: z.array(organizerProfileSummarySchema),
  profile: accountProfileSchema,
  schemaVersion: z.literal("1.0"),
});

export type IdentityDashboard = z.infer<typeof identityDashboardSchema>;

export const incomingEventTeamInvitesSchema = z.array(incomingEventTeamInviteSummarySchema);

export const updateProfileRequestSchema = z.strictObject({
  displayName: z.string().trim().max(80),
  preferredLocale: preferredLocaleSchema,
});

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const createOrganizerProfileRequestSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100),
  locality: z.string().trim().max(100),
  organizerType: organizerTypeSchema,
  website: z.union([z.literal(""), z.url().startsWith("https://").max(500)]),
});

export type CreateOrganizerProfileRequest = z.infer<typeof createOrganizerProfileRequestSchema>;

export const updateOrganizerProfileRequestSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100),
  expectedVersion: z.number().int().positive(),
  locality: z.string().trim().max(100),
  website: z.union([z.literal(""), z.url().startsWith("https://").max(500)]),
});

export type UpdateOrganizerProfileRequest = z.infer<typeof updateOrganizerProfileRequestSchema>;

export const organizerProfileDetailsSchema = organizerProfileSummarySchema.omit({ role: true });

export type OrganizerProfileDetails = z.infer<typeof organizerProfileDetailsSchema>;

export const createDraftEventRequestSchema = z
  .strictObject({
    description: z.string().trim().max(2000),
    endsAt: isoInstant,
    organizerProfileId: opaqueUuid.nullable(),
    publicOrganizerName: z.string().trim().max(100),
    startsAt: isoInstant,
    timezone: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(120),
    visibility: eventVisibilitySchema,
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "Event end must be after its start",
    path: ["endsAt"],
  })
  .refine((value) => value.organizerProfileId !== null || value.publicOrganizerName.length > 0, {
    message: "Public organizer name is required when no organizer is selected",
    path: ["publicOrganizerName"],
  });

export type CreateDraftEventRequest = z.infer<typeof createDraftEventRequestSchema>;

const endsAfterStart = {
  message: "Event end must be after its start",
  path: ["endsAt"],
};

export const updateDraftEventDetailsRequestSchema = z
  .strictObject({
    description: z.string().trim().max(2000),
    endsAt: isoInstant,
    expectedVersion: z.number().int().positive(),
    startsAt: isoInstant,
    timezone: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(120),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), endsAfterStart);

export type UpdateDraftEventDetailsRequest = z.infer<typeof updateDraftEventDetailsRequestSchema>;

export const eventDetailsResultSchema = z.strictObject({
  id: opaqueUuid,
  registrationReset: z.boolean().optional(),
  state: z.literal("draft"),
  version: z.number().int().positive(),
  visibility: eventVisibilitySchema,
});

export type EventDetailsResult = z.infer<typeof eventDetailsResultSchema>;

export const duplicateEventRequestSchema = z
  .strictObject({
    endsAt: isoInstant,
    organizerProfileId: opaqueUuid.nullable(),
    startsAt: isoInstant,
    title: z.string().trim().min(1).max(120),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), endsAfterStart);

export type DuplicateEventRequest = z.infer<typeof duplicateEventRequestSchema>;

export const saveEventBoundaryRequestSchema = z
  .strictObject({
    displayLabel: z.string().trim().max(120),
    expectedVersion: z.number().int().positive().nullable(),
    ring: z.array(boundaryPointSchema).min(3).max(50),
  })
  .refine((value) => new Set(value.ring.map((point) => point.join(","))).size >= 3, {
    message: "A boundary needs at least three distinct points",
    path: ["ring"],
  })
  .refine(
    (value) => {
      const first = value.ring[0];
      const last = value.ring.at(-1);
      return !first || !last || first[0] !== last[0] || first[1] !== last[1];
    },
    { message: "The boundary ring must be open in API requests", path: ["ring"] },
  );

export type SaveEventBoundaryRequest = z.infer<typeof saveEventBoundaryRequestSchema>;

export const saveEventRegistrationRequestSchema = z
  .strictObject({
    allowDuringEvent: z.boolean(),
    closesAt: isoInstant,
    expectedVersion: z.number().int().positive().nullable(),
    opensAt: isoInstant,
  })
  .refine((value) => new Date(value.closesAt) > new Date(value.opensAt), {
    message: "Registration close must be after registration open",
    path: ["closesAt"],
  });

export type SaveEventRegistrationRequest = z.infer<typeof saveEventRegistrationRequestSchema>;

export const updateDraftEventVisibilityRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  visibility: eventVisibilitySchema,
});

export type UpdateDraftEventVisibilityRequest = z.infer<
  typeof updateDraftEventVisibilityRequestSchema
>;

export const deleteDraftEventRequestSchema = z.strictObject({
  confirmTitle: z.string().trim().min(1).max(120),
  expectedVersion: z.number().int().positive(),
});

export type DeleteDraftEventRequest = z.infer<typeof deleteDraftEventRequestSchema>;

export const publishEventRequestSchema = z.strictObject({
  expectedEventVersion: z.number().int().positive(),
});

export const cancelEventRequestSchema = z.strictObject({
  confirmTitle: z.string().trim().min(1).max(120),
  expectedEventVersion: z.number().int().positive(),
  publicReason: z.string().trim().min(3).max(500),
});

export type CancelEventRequest = z.infer<typeof cancelEventRequestSchema>;

export const eventLifecycleResultSchema = z.strictObject({
  state: eventStateSchema,
  version: z.number().int().positive(),
});

export const inviteEventTeamMemberRequestSchema = z.strictObject({
  email: z.email().trim().max(320),
  expectedTeamVersion: z.number().int().positive(),
  role: invitedEventTeamRoleSchema,
});

export type InviteEventTeamMemberRequest = z.infer<typeof inviteEventTeamMemberRequestSchema>;

export const acceptEventTeamInviteRequestSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
});

export type AcceptEventTeamInviteRequest = z.infer<typeof acceptEventTeamInviteRequestSchema>;

export const eventTeamVersionRequestSchema = z.strictObject({
  expectedTeamVersion: z.number().int().positive(),
});

export type EventTeamVersionRequest = z.infer<typeof eventTeamVersionRequestSchema>;

export const enrollRecoveryCodeRequestSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
});

export type EnrollRecoveryCodeRequest = z.infer<typeof enrollRecoveryCodeRequestSchema>;

export const setEmergencySuccessorRequestSchema = z.strictObject({
  expectedTeamVersion: z.number().int().positive(),
  successorMembershipId: opaqueUuid,
  targetOrganizerProfileId: opaqueUuid,
});

export type SetEmergencySuccessorRequest = z.infer<typeof setEmergencySuccessorRequestSchema>;

export const publicationReadinessBlockerSchema = z.enum([
  "event_not_draft",
  "owner_email_unverified",
  "recovery_code_missing",
  "boundary_missing",
  "registration_missing",
  "publication_attestation_missing",
  "first_event_review_required",
  "first_event_review_pending",
  "first_event_review_rejected",
  "routing_not_ready",
  "public_delivery_not_ready",
]);

export const firstEventReviewStatusSchema = z.strictObject({
  decidedAt: isoInstant.nullable(),
  reason: z.string().max(500).nullable(),
  requestedAt: isoInstant.nullable(),
  status: z.enum(["none", "pending", "approved", "rejected"]),
});

export type FirstEventReviewStatus = z.infer<typeof firstEventReviewStatusSchema>;

export const requestFirstEventReviewSchema = z.strictObject({
  expectedEventVersion: z.number().int().positive(),
});

export const admissionModeSchema = z.enum(["auto_inside", "host_approval", "invite_only"]);
export const participationStateSchema = z.enum([
  "pending",
  "waitlisted",
  "approved",
  "withdrawn",
  "rejected",
  "suspended",
  "revoked",
  "pending_address_change",
  "pending_reschedule_confirmation",
]);

export const sellerLocationSchema = z.strictObject({
  addressLine: z.string().min(3).max(200),
  id: opaqueUuid,
  insideBoundary: z.boolean(),
  latitude: z.number().min(-90).max(90),
  locality: z.string().max(100).nullable(),
  longitude: z.number().min(-180).max(180),
  needsReview: z.boolean(),
  placement: z.enum(["manual", "geocoded", "corrected"]),
  postalCode: z.string().max(6).nullable(),
  sellerCount: z.number().int().positive(),
});

export const sellerParticipationSchema = z.strictObject({
  appliedAt: isoInstant,
  decisionReason: z.string().max(500).nullable(),
  displayName: z.string().min(1).max(80),
  eventId: opaqueUuid,
  geographicException: z.boolean(),
  id: opaqueUuid,
  location: sellerLocationSchema.nullable(),
  state: participationStateSchema,
  version: z.number().int().positive(),
});

export type SellerParticipation = z.infer<typeof sellerParticipationSchema>;

export const myParticipationsSchema = z.array(
  sellerParticipationSchema.extend({
    eventState: eventStateSchema,
    eventTitle: z.string().max(120),
    startsAt: isoInstant.nullable(),
    timezone: z.string().min(1).max(100),
  }),
);

export type MyParticipation = z.infer<typeof myParticipationsSchema>[number];

export const eventForSellerSchema = z.strictObject({
  admissionMode: admissionModeSchema,
  boundary: z.array(boundaryPointSchema).nullable(),
  description: z.string().max(2000),
  endsAt: isoInstant.nullable(),
  id: opaqueUuid,
  organizerDisplayName: z.string().max(100),
  participation: sellerParticipationSchema.nullable(),
  placesFull: z.boolean(),
  registrationClosesAt: isoInstant.nullable(),
  registrationOpen: z.boolean(),
  startsAt: isoInstant.nullable(),
  state: eventStateSchema,
  timezone: z.string().min(1).max(100),
  title: z.string().max(120),
});

export type EventForSeller = z.infer<typeof eventForSellerSchema>;

const postalCodeInput = z.union([
  z.literal(""),
  z
    .string()
    .trim()
    .regex(/^[0-9]{3} ?[0-9]{2}$/u),
]);

const sellerAddressFields = {
  addressLine: z.string().trim().min(3).max(200),
  latitude: z.number().min(-90).max(90),
  locality: z.string().trim().max(100),
  longitude: z.number().min(-180).max(180),
  // "geocoded" when the seller kept the proposed point unchanged.
  placement: z.enum(["manual", "geocoded"]),
  postalCode: postalCodeInput,
  rightToUseAttested: z.literal(true),
  // Answer to the shared-entrance question; null until it is asked.
  sharesEntrance: z.boolean().nullable(),
};

export const applyToEventRequestSchema = z.strictObject({
  ...sellerAddressFields,
  displayName: z.string().trim().min(1).max(80),
});

export type ApplyToEventRequest = z.infer<typeof applyToEventRequestSchema>;

export const changeParticipationAddressRequestSchema = z.strictObject({
  ...sellerAddressFields,
  expectedVersion: z.number().int().positive(),
});

export type ChangeParticipationAddressRequest = z.infer<
  typeof changeParticipationAddressRequestSchema
>;

export const geocodeRequestSchema = z.strictObject({
  addressLine: z.string().trim().min(3).max(200),
  locality: z.string().trim().max(100),
  postalCode: postalCodeInput,
});

export type GeocodeRequest = z.infer<typeof geocodeRequestSchema>;

export const geocodeResultSchema = z.strictObject({
  found: z.boolean(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
});

export type GeocodeResult = z.infer<typeof geocodeResultSchema>;

export const locationReviewRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("merge"),
    locationId: opaqueUuid,
    targetLocationId: opaqueUuid,
  }),
  z.strictObject({
    action: z.literal("split"),
    locationId: opaqueUuid,
    participationId: opaqueUuid,
  }),
  z.strictObject({ action: z.literal("confirm_separate"), locationId: opaqueUuid }),
]);

export type LocationReviewRequest = z.infer<typeof locationReviewRequestSchema>;

export const pinCorrectionRequestSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  reason: z.string().trim().min(3).max(500),
});

export type PinCorrectionRequest = z.infer<typeof pinCorrectionRequestSchema>;

export const participationVersionRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});

export const eventSellersSchema = z.strictObject({
  admissionMode: admissionModeSchema,
  eventId: opaqueUuid,
  eventVersion: z.number().int().positive(),
  locationCount: z.number().int().nonnegative(),
  placesUsed: z.number().int().nonnegative(),
  sellerLimit: z.number().int().nonnegative(),
  sellers: z.array(sellerParticipationSchema),
  waitlistPromotionPaused: z.boolean(),
});

export type EventSellers = z.infer<typeof eventSellersSchema>;

export const decideSellerRequestSchema = z.strictObject({
  decision: z.enum(["approve", "waitlist", "reject", "revoke"]),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
});

export type DecideSellerRequest = z.infer<typeof decideSellerRequestSchema>;

export const updateEventAdmissionRequestSchema = z.strictObject({
  admissionMode: admissionModeSchema,
  expectedVersion: z.number().int().positive(),
  waitlistPromotionPaused: z.boolean(),
});

export type UpdateEventAdmissionRequest = z.infer<typeof updateEventAdmissionRequestSchema>;

const graphemeCount = (value: string) =>
  [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length;
const tagInput = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((value) => graphemeCount(value) <= 30, { message: "At most 30 characters" });
const uniqueTags = (tags: readonly string[]) =>
  new Set(tags.map((tag) => tag.trim().replace(/\s+/gu, " ").toLowerCase())).size === tags.length;

export const taxonomyCategorySchema = z.strictObject({
  enabled: z.boolean(),
  id: opaqueUuid,
  isOther: z.boolean(),
  key: z.string().regex(/^[a-z_]+$/u),
  label: z.strictObject({ en: z.string().max(60), sv: z.string().max(60) }),
});

export type TaxonomyCategory = z.infer<typeof taxonomyCategorySchema>;

export const eventTaxonomySchema = z.strictObject({
  categories: z.array(taxonomyCategorySchema).max(14),
  suggestedTags: z.array(z.string().max(60)).max(12),
  taxonomyKey: z.string().max(40),
  version: z.number().int().positive(),
});

export type EventTaxonomy = z.infer<typeof eventTaxonomySchema>;

export const saveEventTaxonomyRequestSchema = z.strictObject({
  enabledCategoryIds: z.array(opaqueUuid).min(1).max(14),
  expectedVersion: z.number().int().positive(),
  suggestedTags: z.array(tagInput).max(12).refine(uniqueTags, { message: "Duplicate tag" }),
});

export type SaveEventTaxonomyRequest = z.infer<typeof saveEventTaxonomyRequestSchema>;

const triState = z.boolean().nullable();
const listingAccessibilitySchema = z.strictObject({
  elevator: triState,
  setting: z.enum(["indoor", "outdoor", "both"]).nullable(),
  stairs: triState,
  stepFree: triState,
  strollerFriendly: triState,
});

const availabilitySlotSchema = z
  .strictObject({ endsAt: isoInstant, startsAt: isoInstant })
  .refine((slot) => new Date(slot.endsAt) > new Date(slot.startsAt), {
    message: "End must be after start",
  });

export const sellerListingSchema = z.strictObject({
  accessibility: listingAccessibilitySchema,
  availability: z.array(availabilitySlotSchema).max(10),
  categoryIds: z.array(opaqueUuid).max(5),
  description: z.string().max(1000),
  earlyVisibilityOptOut: z.boolean(),
  items: z
    .array(
      z.strictObject({
        categoryId: opaqueUuid,
        currency: z.string().regex(/^[A-Z]{3}$/u),
        id: opaqueUuid,
        name: z.string().max(80),
        priceMinor: z.number().int().min(0).max(10_000_000).nullable(),
        status: z.enum(["available", "sold"]),
      }),
    )
    .max(20),
  liveStatus: z
    .strictObject({
      setAt: isoInstant,
      status: z.enum(["open", "away", "closed_early"]),
      until: isoInstant.nullable(),
    })
    .nullable(),
  tags: z.array(z.string().max(60)).max(10),
  title: z.string().max(80).nullable(),
  version: z.number().int().nonnegative(),
});

export type SellerListing = z.infer<typeof sellerListingSchema>;

export const saveSellerListingRequestSchema = z.strictObject({
  accessibility: listingAccessibilitySchema,
  availability: z.array(availabilitySlotSchema).max(10),
  categoryIds: z.array(opaqueUuid).min(1).max(5),
  description: z.string().trim().max(1000),
  earlyVisibilityOptOut: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
  items: z
    .array(
      z.strictObject({
        categoryId: opaqueUuid,
        name: z.string().trim().min(1).max(80),
        priceMinor: z.number().int().min(0).max(10_000_000).nullable(),
        status: z.enum(["available", "sold"]),
      }),
    )
    .max(20),
  tags: z.array(tagInput).max(10).refine(uniqueTags, { message: "Duplicate tag" }),
  title: z.union([z.literal(""), z.string().trim().min(1).max(80)]),
});

export type SaveSellerListingRequest = z.infer<typeof saveSellerListingRequestSchema>;

export const setLiveStatusRequestSchema = z.strictObject({
  reason: z.string().trim().max(500).optional(),
  status: z.enum(["open", "away", "closed_early"]),
  until: isoInstant.nullable(),
});

export type SetLiveStatusRequest = z.infer<typeof setLiveStatusRequestSchema>;

export const adminStatusSchema = z.strictObject({
  elevated: z.boolean(),
  eligible: z.boolean(),
  expiresAt: isoInstant.nullable(),
});

export type AdminStatus = z.infer<typeof adminStatusSchema>;

export const adminEventSummarySchema = z.strictObject({
  endsAt: isoInstant.nullable(),
  id: opaqueUuid,
  organizerDisplayName: z.string().max(100),
  startsAt: isoInstant.nullable(),
  state: eventStateSchema,
  timezone: z.string().min(1).max(100),
  title: z.string().max(120),
  version: z.number().int().positive(),
  visibility: eventVisibilitySchema,
});

export type AdminEventSummary = z.infer<typeof adminEventSummarySchema>;

export const adminEventInterventionRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("cancel"),
    expectedEventVersion: z.number().int().positive(),
    internalReason: z.string().trim().min(3).max(500),
    publicReason: z.string().trim().min(3).max(500),
  }),
  z.strictObject({
    action: z.literal("end_early"),
    expectedEventVersion: z.number().int().positive(),
    internalReason: z.string().trim().min(3).max(500),
  }),
]);

export type AdminEventInterventionRequest = z.infer<typeof adminEventInterventionRequestSchema>;

export const adminElevationRequestSchema = z.strictObject({
  code: z.string().regex(/^[0-9]{6}$/u),
});

export const firstEventReviewQueueItemSchema = z.strictObject({
  current: z.boolean(),
  description: z.string().max(5_000),
  eventId: opaqueUuid,
  eventVersion: z.number().int().positive(),
  organizerName: z.string().max(200),
  organizerType: organizerTypeSchema,
  ownEvent: z.boolean(),
  requestedAt: isoInstant,
  title: z.string().max(200),
  visibility: eventVisibilitySchema,
});

export const firstEventReviewQueueSchema = z.array(firstEventReviewQueueItemSchema).max(500);

export type FirstEventReviewQueueItem = z.infer<typeof firstEventReviewQueueItemSchema>;

export const decideFirstEventReviewSchema = z.strictObject({
  decision: z.enum(["approved", "rejected"]),
  expectedEventVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

export type DecideFirstEventReviewRequest = z.infer<typeof decideFirstEventReviewSchema>;

export const publicationReadinessRecommendationSchema = z.enum([
  "totp_recommended",
  "emergency_successor_recommended",
]);

export const eventPublicationReadinessSchema = z.strictObject({
  blockers: z.array(publicationReadinessBlockerSchema),
  eventId: opaqueUuid,
  eventVersion: z.number().int().positive(),
  readyToPublish: z.boolean(),
  recommendations: z.array(publicationReadinessRecommendationSchema),
});

export type EventPublicationReadiness = z.infer<typeof eventPublicationReadinessSchema>;

export const attestEventPublicationRequestSchema = z.strictObject({
  expectedBoundaryVersion: z.number().int().positive(),
  expectedEventVersion: z.number().int().positive(),
  expectedRegistrationVersion: z.number().int().positive(),
  locationAuthorityConfirmed: z.literal(true),
  visibilityUnderstood: z.literal(true),
});

export type AttestEventPublicationRequest = z.infer<typeof attestEventPublicationRequestSchema>;

export const initiateEventOwnershipTransferRequestSchema = z.strictObject({
  expectedTeamVersion: z.number().int().positive(),
  targetOrganizerProfileId: opaqueUuid,
  toMembershipId: opaqueUuid,
});

export type InitiateEventOwnershipTransferRequest = z.infer<
  typeof initiateEventOwnershipTransferRequestSchema
>;

export const organizerTeamMemberSummarySchema = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  id: opaqueUuid,
  role: z.enum(["owner", "manager"]),
});

export const pendingOrganizerInviteSummarySchema = z.strictObject({
  email: z.email().max(320),
  expiresAt: isoInstant,
  id: opaqueUuid,
});

export const organizerTeamSummarySchema = z.strictObject({
  currentMembershipId: opaqueUuid,
  members: z.array(organizerTeamMemberSummarySchema),
  organizerProfileId: opaqueUuid,
  pendingInvites: z.array(pendingOrganizerInviteSummarySchema),
  teamVersion: z.number().int().positive(),
});

export type OrganizerTeamSummary = z.infer<typeof organizerTeamSummarySchema>;

export const incomingOrganizerInviteSummarySchema = z.strictObject({
  expiresAt: isoInstant,
  id: opaqueUuid,
  organizerDisplayName: z.string().trim().min(1).max(100),
  organizerProfileId: opaqueUuid,
});

export const incomingOrganizerInvitesSchema = z.array(incomingOrganizerInviteSummarySchema);
export type IncomingOrganizerInviteSummary = z.infer<typeof incomingOrganizerInviteSummarySchema>;

export const inviteOrganizerManagerRequestSchema = z.strictObject({
  email: z.email().trim().max(320),
  expectedTeamVersion: z.number().int().positive(),
});

export type InviteOrganizerManagerRequest = z.infer<typeof inviteOrganizerManagerRequestSchema>;

export const updateEventTeamMemberRoleRequestSchema = z.strictObject({
  expectedTeamVersion: z.number().int().positive(),
  role: invitedEventTeamRoleSchema,
});

export type UpdateEventTeamMemberRoleRequest = z.infer<
  typeof updateEventTeamMemberRoleRequestSchema
>;

export const commandResourceResponseSchema = z.strictObject({
  id: opaqueUuid,
  schemaVersion: z.literal("1.0"),
});

export type CommandResourceResponse = z.infer<typeof commandResourceResponseSchema>;

const publicArtifactReferenceSchema = z.strictObject({
  byteSize: z.number().int().nonnegative().max(2_000_000),
  id: opaqueUuid,
  sha256,
});

export const publicEventManifestSchema = z.strictObject({
  eventId: opaqueUuid,
  expiresAt: isoInstant,
  generatedAt: isoInstant,
  publicRevision: z.number().int().nonnegative(),
  routingVersion: opaqueUuid.nullable(),
  safetySequence: z.number().int().nonnegative(),
  schemaVersion: z.literal("1.0"),
  snapshot: publicArtifactReferenceSchema.nullable(),
  state: z.enum(["published", "active", "postponed", "ended", "cancelled"]),
});

export type PublicEventManifest = z.infer<typeof publicEventManifestSchema>;

export const safeOperationalEventSchema = z.strictObject({
  correlationId: opaqueUuid,
  deploymentRevision: z.string().min(1).max(80),
  durationMs: z.number().int().nonnegative().max(600_000),
  errorClass: z.string().min(1).max(80).optional(),
  eventScopeId: opaqueUuid.optional(),
  generatedAt: isoInstant,
  operation: z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/u),
  schemaVersion: z.literal("1.0"),
  status: z.enum(["succeeded", "failed", "degraded", "denied"]),
});

export type SafeOperationalEvent = z.infer<typeof safeOperationalEventSchema>;

export const queueEnvelopeSchema = z.strictObject({
  correlationId: opaqueUuid,
  createdAt: isoInstant,
  id: opaqueUuid,
  idempotencyKey: z.string().min(16).max(200),
  schemaVersion: z.literal("1.0"),
  type: z.enum([
    "snapshot.publish",
    "snapshot.invalidate",
    "email.deliver",
    "export.prepare",
    "graph.launch",
  ]),
});

export type QueueEnvelope = z.infer<typeof queueEnvelopeSchema>;

export const boundarySchemas = {
  BrowserSessionResponse: browserSessionResponseSchema,
  BrowserOtpStart: browserOtpStartSchema,
  BrowserOtpVerify: browserOtpVerifySchema,
  BrowserCallback: browserCallbackSchema,
  BrowserAuthSuccess: browserAuthSuccessSchema,
  AcceptEventTeamInviteRequest: acceptEventTeamInviteRequestSchema,
  AccountProfile: accountProfileSchema,
  AccountRecoveryStatus: accountRecoveryStatusSchema,
  AccountDeletionStatus: accountDeletionStatusSchema,
  MfaStatus: mfaStatusSchema,
  OrganizerVerificationStatus: organizerVerificationStatusSchema,
  RequestOrganizerVerification: requestOrganizerVerificationSchema,
  OrganizerVerificationQueue: organizerVerificationQueueSchema,
  DecideOrganizerVerification: decideOrganizerVerificationSchema,
  PublishEventRequest: publishEventRequestSchema,
  CancelEventRequest: cancelEventRequestSchema,
  SellerParticipation: sellerParticipationSchema,
  MyParticipations: myParticipationsSchema,
  EventForSeller: eventForSellerSchema,
  ApplyToEventRequest: applyToEventRequestSchema,
  EventTaxonomy: eventTaxonomySchema,
  SaveEventTaxonomyRequest: saveEventTaxonomyRequestSchema,
  SellerListing: sellerListingSchema,
  SaveSellerListingRequest: saveSellerListingRequestSchema,
  SetLiveStatusRequest: setLiveStatusRequestSchema,
  ChangeParticipationAddressRequest: changeParticipationAddressRequestSchema,
  GeocodeRequest: geocodeRequestSchema,
  GeocodeResult: geocodeResultSchema,
  LocationReviewRequest: locationReviewRequestSchema,
  PinCorrectionRequest: pinCorrectionRequestSchema,
  ParticipationVersionRequest: participationVersionRequestSchema,
  EventSellers: eventSellersSchema,
  DecideSellerRequest: decideSellerRequestSchema,
  UpdateEventAdmissionRequest: updateEventAdmissionRequestSchema,
  UpdateDraftEventDetailsRequest: updateDraftEventDetailsRequestSchema,
  EventDetailsResult: eventDetailsResultSchema,
  DuplicateEventRequest: duplicateEventRequestSchema,
  UpdateOrganizerProfileRequest: updateOrganizerProfileRequestSchema,
  OrganizerProfileDetails: organizerProfileDetailsSchema,
  AdminEventSummary: adminEventSummarySchema,
  AdminEventInterventionRequest: adminEventInterventionRequestSchema,
  EventLifecycleResult: eventLifecycleResultSchema,
  FirstEventReviewStatus: firstEventReviewStatusSchema,
  RequestFirstEventReview: requestFirstEventReviewSchema,
  AdminStatus: adminStatusSchema,
  AdminElevationRequest: adminElevationRequestSchema,
  FirstEventReviewQueue: firstEventReviewQueueSchema,
  DecideFirstEventReview: decideFirstEventReviewSchema,
  TotpEnrollment: totpEnrollmentSchema,
  TotpVerifyRequest: totpVerifyRequestSchema,
  RequestAccountDeletionRequest: requestAccountDeletionRequestSchema,
  AccountRecoveryClaim: accountRecoveryClaimSchema,
  AccountRecoveryCompletion: accountRecoveryCompletionSchema,
  AccountRecoveryTokenRequest: accountRecoveryTokenRequestSchema,
  ApiError: apiErrorSchema,
  AttestEventPublicationRequest: attestEventPublicationRequestSchema,
  BoundaryPoint: boundaryPointSchema,
  CommandResourceResponse: commandResourceResponseSchema,
  CreateDraftEventRequest: createDraftEventRequestSchema,
  CreateOrganizerProfileRequest: createOrganizerProfileRequestSchema,
  DeleteDraftEventRequest: deleteDraftEventRequestSchema,
  DraftEventSummary: draftEventSummarySchema,
  EventBoundarySummary: eventBoundarySummarySchema,
  EventControlSummary: eventControlSummarySchema,
  EventIntervalSummary: eventIntervalSummarySchema,
  EventPublicationReadiness: eventPublicationReadinessSchema,
  EventRegistrationSummary: eventRegistrationSummarySchema,
  EventState: eventStateSchema,
  EventTeamMemberSummary: eventTeamMemberSummarySchema,
  EventTeamRole: eventTeamRoleSchema,
  EventTeamSummary: eventTeamSummarySchema,
  EventTeamVersionRequest: eventTeamVersionRequestSchema,
  EnrollRecoveryCodeRequest: enrollRecoveryCodeRequestSchema,
  IdentityDashboard: identityDashboardSchema,
  InitiateAccountRecoveryRequest: initiateAccountRecoveryRequestSchema,
  InitiateAccountRecoveryResponse: initiateAccountRecoveryResponseSchema,
  IncomingEventTeamInviteSummary: incomingEventTeamInviteSummarySchema,
  IncomingOrganizerInviteSummary: incomingOrganizerInviteSummarySchema,
  InitiateEventOwnershipTransferRequest: initiateEventOwnershipTransferRequestSchema,
  InviteOrganizerManagerRequest: inviteOrganizerManagerRequestSchema,
  InviteEventTeamMemberRequest: inviteEventTeamMemberRequestSchema,
  OrganizerProfileSummary: organizerProfileSummarySchema,
  OrganizerTeamMemberSummary: organizerTeamMemberSummarySchema,
  OrganizerTeamSummary: organizerTeamSummarySchema,
  OwnershipTransferOption: ownershipTransferOptionSchema,
  PendingEventTeamInviteSummary: pendingEventTeamInviteSummarySchema,
  PendingEventOwnershipTransferSummary: pendingEventOwnershipTransferSummarySchema,
  PendingEmergencySuccessorClaim: pendingEmergencySuccessorClaimSchema,
  PendingOrganizerInviteSummary: pendingOrganizerInviteSummarySchema,
  PublicationReadinessBlocker: publicationReadinessBlockerSchema,
  PublicationReadinessRecommendation: publicationReadinessRecommendationSchema,
  PublicEventManifest: publicEventManifestSchema,
  QueueEnvelope: queueEnvelopeSchema,
  ReadinessResponse: readinessResponseSchema,
  RecoveryCodeEnrollmentResponse: recoveryCodeEnrollmentResponseSchema,
  SafeOperationalEvent: safeOperationalEventSchema,
  SaveEventBoundaryRequest: saveEventBoundaryRequestSchema,
  SaveEventRegistrationRequest: saveEventRegistrationRequestSchema,
  SetEmergencySuccessorRequest: setEmergencySuccessorRequestSchema,
  UpdateEventTeamMemberRoleRequest: updateEventTeamMemberRoleRequestSchema,
  UpdateProfileRequest: updateProfileRequestSchema,
  UpdateDraftEventVisibilityRequest: updateDraftEventVisibilityRequestSchema,
} as const;
