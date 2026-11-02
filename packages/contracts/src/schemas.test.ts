import { describe, expect, it } from "vitest";
import {
  publicEventSummarySchema,
  publicSafetyFeedSchema,
  publicSnapshotSchema,
  attestEventPublicationRequestSchema,
  createDraftEventRequestSchema,
  deleteDraftEventRequestSchema,
  eventTeamSummarySchema,
  identityDashboardSchema,
  initiateAccountRecoveryResponseSchema,
  initiateEventOwnershipTransferRequestSchema,
  inviteEventTeamMemberRequestSchema,
  publicEventManifestSchema,
  readinessResponseSchema,
  recoveryCodeEnrollmentResponseSchema,
  safeOperationalEventSchema,
  saveEventBoundaryRequestSchema,
  saveEventRegistrationRequestSchema,
  setEmergencySuccessorRequestSchema,
  updateDraftEventVisibilityRequestSchema,
} from "./schemas";

const generatedAt = "2026-09-07T12:00:00+02:00";
const id = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606";

describe("boundary contracts", () => {
  it("rejects verification secrets in recovery initiation responses", () => {
    const response = {
      id,
      emailVerified: false,
      initiatedAt: generatedAt,
      readyAt: generatedAt,
      expiresAt: generatedAt,
      delivery: "captured_locally",
    };
    expect(initiateAccountRecoveryResponseSchema.safeParse(response).success).toBe(true);
    expect(
      initiateAccountRecoveryResponseSchema.safeParse({
        ...response,
        verificationToken: "x".repeat(43),
      }).success,
    ).toBe(false);
  });
  it("accepts a minimal readiness response", () => {
    expect(
      readinessResponseSchema.parse({
        generatedAt,
        revision: "local",
        schemaVersion: "1.0",
        status: "ok",
      }),
    ).toBeTruthy();
  });

  it("rejects unknown sensitive fields from public manifests", () => {
    const result = publicEventManifestSchema.safeParse({
      eventKey: "a".repeat(32),
      expiresAt: "2026-09-07T18:00:00+02:00",
      generatedAt,
      publicRevision: 1,
      routing: null,
      routingVersion: null,
      safetySequence: 1,
      schemaVersion: "1.0",
      snapshot: null,
      state: "published",
      email: "must-not-leak@example.invalid",
    });

    expect(result.success).toBe(false);
  });

  it("rejects user-authored text and coordinates from safe logs", () => {
    const result = safeOperationalEventSchema.safeParse({
      correlationId: id,
      deploymentRevision: "local",
      durationMs: 12,
      generatedAt,
      latitude: 59.3293,
      operation: "readiness.check",
      schemaVersion: "1.0",
      status: "succeeded",
      text: "private content",
    });

    expect(result.success).toBe(false);
  });

  it("validates an allowlisted identity dashboard", () => {
    expect(
      identityDashboardSchema.parse({
        events: [],
        organizers: [],
        profile: {
          accountId: id,
          displayName: null,
          preferredLocale: "sv",
        },
        schemaVersion: "1.0",
      }),
    ).toBeTruthy();
  });

  it("rejects invalid event time-zone placeholders at the request boundary", () => {
    const result = createDraftEventRequestSchema.safeParse({
      description: "",
      endsAt: "2026-09-08T15:00:00+02:00",
      organizerProfileId: id,
      publicOrganizerName: "",
      startsAt: "2026-09-08T10:00:00+02:00",
      timezone: "",
      title: "Test event",
      visibility: "public",
    });

    expect(result.success).toBe(false);
  });

  it("requires the public organizer name for a first personal event", () => {
    const result = createDraftEventRequestSchema.safeParse({
      description: "",
      endsAt: "2026-09-08T15:00:00+02:00",
      organizerProfileId: null,
      publicOrganizerName: "",
      startsAt: "2026-09-08T10:00:00+02:00",
      timezone: "Europe/Stockholm",
      title: "Test event",
      visibility: "public",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an event ending before it starts", () => {
    const result = createDraftEventRequestSchema.safeParse({
      description: "",
      endsAt: "2026-09-08T09:00:00+02:00",
      organizerProfileId: null,
      publicOrganizerName: "Synthetic Organizer",
      startsAt: "2026-09-08T10:00:00+02:00",
      timezone: "Europe/Stockholm",
      title: "Test event",
      visibility: "public",
    });

    expect(result.success).toBe(false);
  });

  it("accepts an open boundary ring and rejects a pre-closed ring", () => {
    expect(
      saveEventBoundaryRequestSchema.safeParse({
        displayLabel: "Synthetic area",
        expectedVersion: null,
        ring: [
          [18, 59],
          [18.01, 59],
          [18.01, 59.01],
        ],
      }).success,
    ).toBe(true);
    expect(
      saveEventBoundaryRequestSchema.safeParse({
        displayLabel: "Synthetic area",
        expectedVersion: null,
        ring: [
          [18, 59],
          [18.01, 59],
          [18.01, 59.01],
          [18, 59],
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts a valid registration window and rejects reversed times", () => {
    expect(
      saveEventRegistrationRequestSchema.safeParse({
        allowDuringEvent: false,
        closesAt: "2026-09-08T09:00:00+02:00",
        expectedVersion: 1,
        opensAt: "2026-09-07T08:00:00+02:00",
      }).success,
    ).toBe(true);
    expect(
      saveEventRegistrationRequestSchema.safeParse({
        allowDuringEvent: false,
        closesAt: "2026-09-07T08:00:00+02:00",
        expectedVersion: 1,
        opensAt: "2026-09-08T09:00:00+02:00",
      }).success,
    ).toBe(false);
  });

  it("validates versioned draft visibility and deletion inputs", () => {
    expect(
      updateDraftEventVisibilityRequestSchema.safeParse({
        expectedVersion: 2,
        visibility: "unlisted",
      }).success,
    ).toBe(true);
    expect(
      deleteDraftEventRequestSchema.safeParse({
        confirmTitle: "Synthetic event",
        expectedVersion: 2,
      }).success,
    ).toBe(true);
    expect(
      deleteDraftEventRequestSchema.safeParse({
        confirmTitle: "",
        expectedVersion: 0,
      }).success,
    ).toBe(false);
  });

  it("restricts team invitations to a valid email and non-owner role", () => {
    expect(
      inviteEventTeamMemberRequestSchema.safeParse({
        email: "helper@example.invalid",
        expectedTeamVersion: 1,
        role: "co_host",
      }).success,
    ).toBe(true);
    expect(
      inviteEventTeamMemberRequestSchema.safeParse({
        email: "not-an-email",
        expectedTeamVersion: 1,
        role: "owner",
      }).success,
    ).toBe(false);
  });

  it("requires an opaque co-host membership and version to initiate ownership transfer", () => {
    expect(
      initiateEventOwnershipTransferRequestSchema.safeParse({
        expectedTeamVersion: 2,
        targetOrganizerProfileId: id,
        toMembershipId: id,
      }).success,
    ).toBe(true);
    expect(
      initiateEventOwnershipTransferRequestSchema.safeParse({
        expectedTeamVersion: 0,
        targetOrganizerProfileId: id,
        toMembershipId: "an-account-email@example.invalid",
      }).success,
    ).toBe(false);
  });

  it("accepts a one-time recovery code response and rejects leaked hash fields", () => {
    expect(
      recoveryCodeEnrollmentResponseSchema.safeParse({
        active: true,
        code: "ABCD-EFGH-JKLM-NPQR-STUV",
        issuedAt: generatedAt,
        rotatedAt: null,
        version: 1,
      }).success,
    ).toBe(true);
    expect(
      recoveryCodeEnrollmentResponseSchema.safeParse({
        active: true,
        code: "ABCD-EFGH-JKLM-NPQR-STUV",
        codeHash: "must-not-leak",
        issuedAt: generatedAt,
        rotatedAt: null,
        version: 1,
      }).success,
    ).toBe(false);
  });

  it("binds successor selection and publication attestation to current versions", () => {
    expect(
      setEmergencySuccessorRequestSchema.safeParse({
        expectedTeamVersion: 2,
        successorMembershipId: id,
        targetOrganizerProfileId: id,
      }).success,
    ).toBe(true);
    expect(
      attestEventPublicationRequestSchema.safeParse({
        expectedBoundaryVersion: 1,
        expectedEventVersion: 2,
        expectedRegistrationVersion: 1,
        locationAuthorityConfirmed: true,
        visibilityUnderstood: true,
      }).success,
    ).toBe(true);
    expect(
      attestEventPublicationRequestSchema.safeParse({
        expectedBoundaryVersion: 1,
        expectedEventVersion: 2,
        expectedRegistrationVersion: 1,
        locationAuthorityConfirmed: false,
        visibilityUnderstood: true,
      }).success,
    ).toBe(false);
  });

  it("accepts only allowlisted emergency-claim status fields", () => {
    const claim = {
      eventId: id,
      members: [],
      pendingEmergencyClaim: {
        expiresAt: "2026-09-16T12:00:00+02:00",
        id,
        initiatedAt: generatedAt,
        readyAt: "2026-09-08T12:00:00+02:00",
        successorDisplayName: "Synthetic successor",
        successorMembershipId: id,
        targetOrganizerDisplayName: "Synthetic organizer",
      },
      pendingInvites: [],
      teamVersion: 2,
    };
    expect(eventTeamSummarySchema.safeParse(claim).success).toBe(true);
    expect(
      eventTeamSummarySchema.safeParse({
        ...claim,
        pendingEmergencyClaim: {
          ...claim.pendingEmergencyClaim,
          ownerEmail: "must-not-leak@example.invalid",
        },
      }).success,
    ).toBe(false);
  });

  it("public event summaries reject any field outside the allowlist", () => {
    const summary = {
      areaLabel: "Södermalm",
      description: "",
      indexable: true,
      intervals: [{ endsAt: "2031-09-09T13:00:00+00:00", startsAt: "2031-09-09T08:00:00+00:00" }],
      organizer: {
        displayName: "Club",
        locality: null,
        publicKey: "a".repeat(24),
        verified: false,
      },
      originalStartsAt: null,
      publicKey: "b".repeat(32),
      publicNotice: null,
      state: "published",
      timezone: "Europe/Stockholm",
      title: "Walk",
      updatedAt: "2031-09-01T08:00:00+00:00",
      visibility: "public",
    };
    expect(publicEventSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      publicEventSummarySchema.safeParse({ ...summary, id: crypto.randomUUID() }).success,
    ).toBe(false);
    expect(
      publicEventSummarySchema.safeParse({
        ...summary,
        organizer: { ...summary.organizer, createdByAccountId: crypto.randomUUID() },
      }).success,
    ).toBe(false);
    expect(publicEventSummarySchema.safeParse({ ...summary, publicKey: "short" }).success).toBe(
      false,
    );
  });

  it("public snapshots and safety feeds reject unknown or sensitive fields", () => {
    const seller = {
      accessibility: {
        elevator: null,
        setting: null,
        stairs: null,
        stepFree: true,
        strollerFriendly: null,
      },
      availability: [],
      categoryIds: [],
      description: "",
      displayName: "Seller",
      id: "a".repeat(24),
      items: [],
      status: "open",
      stopId: "b".repeat(24),
      tags: [],
      title: null,
    };
    const snapshot = {
      categories: [],
      counts: { byCategory: {}, open: 1, sellers: 1, stops: 1 },
      event: {
        areaLabel: null,
        boundary: null,
        intervals: [],
        state: "active",
        timezone: "Europe/Stockholm",
        title: "Walk",
      },
      eventKey: "c".repeat(32),
      expiresAt: generatedAt,
      generatedAt,
      revision: 1,
      schemaVersion: "1.0",
      sellers: [seller],
      stops: [
        {
          cluster: { z13: "1_2", z15: "3_4" },
          entrance: null,
          manualAccess: false,
          id: "b".repeat(24),
          latitude: 59.3,
          longitude: 18.06,
          sellerIds: ["a".repeat(24)],
        },
      ],
    };
    expect(publicSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      publicSnapshotSchema.safeParse({
        ...snapshot,
        sellers: [{ ...seller, addressLine: "Testgatan 1" }],
      }).success,
    ).toBe(false);
    const feed = {
      awaySellerIds: [],
      blockedEdgeIds: [],
      eventKey: "c".repeat(32),
      expiresAt: generatedAt,
      generatedAt,
      removedSellerIds: ["a".repeat(24)],
      removedStopIds: [],
      requiredGraphVersion: null,
      schemaVersion: "1.0",
      sequence: 3,
      state: "active",
    };
    expect(publicSafetyFeedSchema.safeParse(feed).success).toBe(true);
    expect(publicSafetyFeedSchema.safeParse({ ...feed, latitude: 59.3 }).success).toBe(false);
  });
});
