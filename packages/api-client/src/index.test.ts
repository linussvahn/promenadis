import { afterEach, describe, expect, it, vi } from "vitest";
import { createPromenadisApiClient, PromenadisApiError } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Promenadis API client", () => {
  it("cookie mode sends an account fence, never a bearer, and invalidates stale identity", async () => {
    const changed = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "account_changed",
          correlationId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
          message: "Account changed.",
          schemaVersion: "1.0",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "/api",
      browserSession: true,
      onAccountChanged: changed,
    });
    await expect(
      client.updateProfile("expected-account", { displayName: "Synthetic", preferredLocale: "sv" }),
    ).rejects.toMatchObject({ code: "account_changed" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/profile",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "x-promenadis-browser": "1",
          "x-account-id": "expected-account",
          "content-type": "application/json",
        },
      }),
    );
    expect(changed).toHaveBeenCalledOnce();
  });
  it("sends the bearer token and validates dashboard responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          events: [],
          organizers: [],
          profile: {
            accountId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
            displayName: null,
            preferredLocale: "sv",
          },
          schemaVersion: "1.0",
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(client.getDashboard("session-token")).resolves.toMatchObject({
      schemaVersion: "1.0",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:54321/functions/v1/api-v1/dashboard",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer session-token" }),
      }),
    );
  });

  it("turns versioned API failures into a typed error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "unauthorized",
          correlationId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
          message: "Authentication is required.",
          schemaVersion: "1.0",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(client.getDashboard("bad-token")).rejects.toMatchObject({
      code: "unauthorized",
      name: PromenadisApiError.name,
      status: 401,
    });
  });

  it("saves a boundary through the event-scoped route", async () => {
    const response = {
      areaSquareKilometers: 0.5,
      displayLabel: "Synthetic area",
      ring: [
        [18, 59],
        [18.01, 59],
        [18.01, 59.01],
        [18, 59],
      ],
      spanKilometers: 1.2,
      version: 1,
      warnings: [],
    };
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(
      client.saveEventBoundary("session-token", "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606", {
        displayLabel: "Synthetic area",
        expectedVersion: null,
        ring: [
          [18, 59],
          [18.01, 59],
          [18.01, 59.01],
        ],
      }),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:54321/functions/v1/api-v1/events/01991dd3-a7c7-7ea2-aee5-43ec2cb5f606/boundary",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("saves a registration window through the event-scoped route", async () => {
    const response = {
      allowDuringEvent: false,
      closesAt: "2030-09-08T07:00:00.000Z",
      opensAt: "2030-09-07T06:00:00.000Z",
      version: 2,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(
      client.saveEventRegistration("session-token", "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606", {
        allowDuringEvent: false,
        closesAt: response.closesAt,
        expectedVersion: 1,
        opensAt: response.opensAt,
      }),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:54321/functions/v1/api-v1/events/01991dd3-a7c7-7ea2-aee5-43ec2cb5f606/registration",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("updates draft visibility through the versioned event route", async () => {
    const response = {
      id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606",
      state: "draft",
      version: 2,
      visibility: "unlisted",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(
      client.updateDraftEventVisibility("session-token", response.id, {
        expectedVersion: 1,
        visibility: "unlisted",
      }),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:54321/functions/v1/api-v1/events/${response.id}/visibility`,
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("deletes a confirmed draft through the owner-only event route", async () => {
    const id = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606";
    const response = { id, schemaVersion: "1.0" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(
      client.deleteDraftEvent("session-token", id, {
        confirmTitle: "Synthetic event",
        expectedVersion: 3,
      }),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:54321/functions/v1/api-v1/events/${id}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("creates an event-team invitation through the versioned team route", async () => {
    const eventId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606";
    const response = {
      eventId,
      members: [
        {
          displayName: "Test Owner",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f607",
          role: "owner",
        },
      ],
      pendingInvites: [
        {
          email: "helper@example.invalid",
          expiresAt: "2030-09-15T10:00:00.000Z",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f608",
          role: "moderator",
        },
      ],
      teamVersion: 2,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(
      client.inviteEventTeamMember("session-token", eventId, {
        email: "helper@example.invalid",
        expectedTeamVersion: 1,
        role: "moderator",
      }),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:54321/functions/v1/api-v1/events/${eventId}/team/invites`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("accepts an ownership transfer through the explicit versioned route", async () => {
    const eventId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606";
    const transferId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f610";
    const response = {
      currentMembershipId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609",
      eventId,
      members: [
        {
          canReceiveOwnership: false,
          displayName: "New Owner",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609",
          role: "owner",
        },
      ],
      pendingInvites: [],
      pendingTransfer: null,
      teamVersion: 3,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(
      client.acceptEventOwnershipTransfer("session-token", eventId, transferId, {
        expectedTeamVersion: 2,
      }),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:54321/functions/v1/api-v1/events/${eventId}/team/ownership-transfers/${transferId}/accept`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("creates an organizer-manager invitation through the owner route", async () => {
    const organizerProfileId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f611";
    const response = {
      currentMembershipId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f612",
      members: [
        {
          displayName: "Organizer Owner",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f612",
          role: "owner",
        },
      ],
      organizerProfileId,
      pendingInvites: [
        {
          email: "manager@example.invalid",
          expiresAt: "2030-09-15T10:00:00.000Z",
          id: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f613",
        },
      ],
      teamVersion: 2,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(
      client.inviteOrganizerManager("session-token", organizerProfileId, {
        email: "manager@example.invalid",
        expectedTeamVersion: 1,
      }),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:54321/functions/v1/api-v1/organizers/${organizerProfileId}/team/invites`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("creates a one-time recovery code through the account route", async () => {
    const response = {
      active: true,
      code: "ABCD-EFGH-JKLM-NPQR-STUV",
      issuedAt: "2030-09-09T10:00:00.000Z",
      rotatedAt: null,
      version: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(
      client.enrollRecoveryCode("session-token", { expectedVersion: 0 }),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:54321/functions/v1/api-v1/account/recovery-code",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reads publication readiness through the event route", async () => {
    const eventId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606";
    const response = {
      blockers: ["first_event_review_pending", "routing_not_ready", "public_delivery_not_ready"],
      eventId,
      eventVersion: 2,
      readyToPublish: false,
      recommendations: ["totp_recommended"],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await expect(client.getEventPublicationReadiness("session-token", eventId)).resolves.toEqual(
      response,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:54321/functions/v1/api-v1/events/${eventId}/publication-readiness`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses explicit versioned routes for the emergency-successor claim lifecycle", async () => {
    const eventId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f606";
    const claimId = "01991dd3-a7c7-7ea2-aee5-43ec2cb5f610";
    const response = {
      eventId,
      members: [],
      pendingEmergencyClaim: {
        expiresAt: "2030-09-16T10:00:00.000Z",
        id: claimId,
        initiatedAt: "2030-09-09T10:00:00.000Z",
        readyAt: "2030-09-10T10:00:00.000Z",
        successorDisplayName: "Successor",
        successorMembershipId: "01991dd3-a7c7-7ea2-aee5-43ec2cb5f609",
        targetOrganizerDisplayName: "Successor organizer",
      },
      pendingInvites: [],
      teamVersion: 3,
    };
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    globalThis.fetch = fetchMock;
    const client = createPromenadisApiClient({
      baseUrl: "http://127.0.0.1:54321",
      publishableKey: "public-local-key",
    });

    await client.initiateEmergencySuccessorClaim("session-token", eventId, {
      expectedTeamVersion: 2,
    });
    await client.completeEmergencySuccessorClaim("session-token", eventId, claimId, {
      expectedTeamVersion: 3,
    });
    await client.cancelEmergencySuccessorClaim("session-token", eventId, claimId, {
      expectedTeamVersion: 3,
    });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [
        `http://127.0.0.1:54321/functions/v1/api-v1/events/${eventId}/team/emergency-successor-claims`,
        "POST",
      ],
      [
        `http://127.0.0.1:54321/functions/v1/api-v1/events/${eventId}/team/emergency-successor-claims/${claimId}/complete`,
        "POST",
      ],
      [
        `http://127.0.0.1:54321/functions/v1/api-v1/events/${eventId}/team/emergency-successor-claims/${claimId}`,
        "DELETE",
      ],
    ]);
  });
});
