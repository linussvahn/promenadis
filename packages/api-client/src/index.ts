import {
  type AcceptEventTeamInviteRequest,
  type AccountRecoveryTokenRequest,
  type AttestEventPublicationRequest,
  type RequestAccountDeletionRequest,
  type DecideFirstEventReviewRequest,
  type CancelEventRequest,
  type ApplyToEventRequest,
  type DecideSellerRequest,
  type UpdateEventAdmissionRequest,
  eventForSellerSchema,
  eventSellersSchema,
  myParticipationsSchema,
  sellerParticipationSchema,
  type AdminEventInterventionRequest,
  type DuplicateEventRequest,
  type UpdateDraftEventDetailsRequest,
  type UpdateOrganizerProfileRequest,
  adminEventSummarySchema,
  eventDetailsResultSchema,
  organizerProfileDetailsSchema,
  type DecideOrganizerVerificationRequest,
  type RequestOrganizerVerificationRequest,
  accountDeletionStatusSchema,
  adminStatusSchema,
  organizerVerificationQueueSchema,
  organizerVerificationStatusSchema,
  eventLifecycleResultSchema,
  firstEventReviewQueueSchema,
  firstEventReviewStatusSchema,
  mfaStatusSchema,
  totpEnrollmentSchema,
  accountRecoveryClaimSchema,
  accountRecoveryCompletionSchema,
  accountRecoveryStatusSchema,
  apiErrorSchema,
  type CreateDraftEventRequest,
  type CreateOrganizerProfileRequest,
  commandResourceResponseSchema,
  type DeleteDraftEventRequest,
  type EnrollRecoveryCodeRequest,
  type EventTeamVersionRequest,
  eventBoundarySummarySchema,
  eventControlSummarySchema,
  eventPublicationReadinessSchema,
  eventRegistrationSummarySchema,
  eventTeamSummarySchema,
  type IdentityDashboard,
  type InitiateAccountRecoveryRequest,
  type InitiateEventOwnershipTransferRequest,
  type InviteEventTeamMemberRequest,
  type InviteOrganizerManagerRequest,
  identityDashboardSchema,
  incomingEventTeamInvitesSchema,
  incomingOrganizerInvitesSchema,
  initiateAccountRecoveryResponseSchema,
  organizerTeamSummarySchema,
  recoveryCodeEnrollmentResponseSchema,
  type SaveEventBoundaryRequest,
  type SaveEventRegistrationRequest,
  type SetEmergencySuccessorRequest,
  type UpdateDraftEventVisibilityRequest,
  type UpdateEventTeamMemberRoleRequest,
  type UpdateProfileRequest,
} from "@promenadis/contracts";
import type { z } from "zod";

export interface ApiClientConfig {
  readonly baseUrl: string;
  readonly publishableKey?: string;
  /** In cookie mode the method credential is the expected account ID, never a bearer token. */
  readonly browserSession?: boolean;
  readonly onAccountChanged?: () => void;
}

export class PromenadisApiError extends Error {
  readonly code: string;
  readonly correlationId: string | null;
  readonly status: number;

  constructor(message: string, status: number, code: string, correlationId: string | null) {
    super(message);
    this.name = "PromenadisApiError";
    this.code = code;
    this.correlationId = correlationId;
    this.status = status;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new PromenadisApiError(
      "The server returned an unexpected response.",
      response.status,
      "unexpected_response",
      response.headers.get("x-correlation-id"),
    );
  }
  return response.json();
}

export function createPromenadisApiClient(config: ApiClientConfig) {
  async function request<T>(
    path: string,
    accessToken: string,
    schema: z.ZodType<T>,
    init?: { readonly body?: unknown; readonly method?: "DELETE" | "GET" | "POST" | "PUT" },
  ): Promise<T> {
    const requestInit: RequestInit = {
      headers: config.browserSession
        ? {
            "x-promenadis-browser": "1",
            "x-account-id": accessToken,
            "content-type": "application/json",
          }
        : {
            apikey: config.publishableKey ?? "",
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
      method: init?.method ?? "GET",
      credentials: config.browserSession ? "same-origin" : "omit",
      cache: "no-store",
    };
    if (init?.body !== undefined) requestInit.body = JSON.stringify(init.body);
    const response = await fetch(
      `${config.baseUrl}${config.browserSession ? "" : "/functions/v1/api-v1"}${path}`,
      requestInit,
    );
    const body = await parseJson(response);

    if (!response.ok) {
      if (config.browserSession && (response.status === 401 || response.status === 409)) {
        config.onAccountChanged?.();
      }
      const parsedError = apiErrorSchema.safeParse(body);
      throw new PromenadisApiError(
        parsedError.success ? parsedError.data.message : "The request failed.",
        response.status,
        parsedError.success ? parsedError.data.code : "request_failed",
        parsedError.success
          ? parsedError.data.correlationId
          : response.headers.get("x-correlation-id"),
      );
    }

    return schema.parse(body);
  }

  async function publicRequest<T>(path: string, schema: z.ZodType<T>, body: unknown): Promise<T> {
    const response = await fetch(
      `${config.baseUrl}${config.browserSession ? "" : "/functions/v1/api-v1"}${path}`,
      {
        body: JSON.stringify(body),
        headers: config.browserSession
          ? { "x-promenadis-browser": "1", "content-type": "application/json" }
          : { apikey: config.publishableKey ?? "", "content-type": "application/json" },
        credentials: config.browserSession ? "same-origin" : "omit",
        cache: "no-store",
        method: "POST",
      },
    );
    const parsedBody = await parseJson(response);
    if (!response.ok) {
      const parsedError = apiErrorSchema.safeParse(parsedBody);
      throw new PromenadisApiError(
        parsedError.success ? parsedError.data.message : "The request failed.",
        response.status,
        parsedError.success ? parsedError.data.code : "request_failed",
        parsedError.success
          ? parsedError.data.correlationId
          : response.headers.get("x-correlation-id"),
      );
    }
    return schema.parse(parsedBody);
  }

  return {
    cancelAccountRecovery(accessToken: string, claimId: string) {
      return request(
        `/account/recovery-claims/${claimId}/cancel`,
        accessToken,
        accountRecoveryStatusSchema,
        { method: "POST" },
      );
    },
    completeAccountRecovery(claimId: string, input: AccountRecoveryTokenRequest) {
      return publicRequest(
        `/account-recovery/${claimId}/complete`,
        accountRecoveryCompletionSchema,
        input,
      );
    },
    readAccountRecoveryClaim(claimId: string, input: AccountRecoveryTokenRequest) {
      return publicRequest(
        `/account-recovery/${claimId}/status`,
        accountRecoveryClaimSchema,
        input,
      );
    },
    confirmAccountRecoveryEmail(claimId: string, input: AccountRecoveryTokenRequest) {
      return publicRequest(
        `/account-recovery/${claimId}/verify`,
        accountRecoveryClaimSchema,
        input,
      );
    },
    initiateAccountRecovery(input: InitiateAccountRecoveryRequest) {
      return publicRequest("/account-recovery", initiateAccountRecoveryResponseSchema, input);
    },
    acceptEventTeamInvite(
      accessToken: string,
      inviteId: string,
      input: AcceptEventTeamInviteRequest,
    ) {
      return request(`/team-invites/${inviteId}/accept`, accessToken, eventTeamSummarySchema, {
        body: input,
        method: "POST",
      });
    },
    acceptOrganizerManagerInvite(
      accessToken: string,
      inviteId: string,
      input: AcceptEventTeamInviteRequest,
    ) {
      return request(
        `/organizer-invites/${inviteId}/accept`,
        accessToken,
        organizerTeamSummarySchema,
        { body: input, method: "POST" },
      );
    },
    cancelEventTeamInvite(
      accessToken: string,
      eventId: string,
      inviteId: string,
      input: EventTeamVersionRequest,
    ) {
      return request(
        `/events/${eventId}/team/invites/${inviteId}`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "DELETE" },
      );
    },
    cancelEventOwnershipTransfer(
      accessToken: string,
      eventId: string,
      transferId: string,
      input: EventTeamVersionRequest,
    ) {
      return request(
        `/events/${eventId}/team/ownership-transfers/${transferId}`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "DELETE" },
      );
    },
    cancelEmergencySuccessorClaim(
      accessToken: string,
      eventId: string,
      claimId: string,
      input: EventTeamVersionRequest,
    ) {
      return request(
        `/events/${eventId}/team/emergency-successor-claims/${claimId}`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "DELETE" },
      );
    },
    cancelOrganizerManagerInvite(
      accessToken: string,
      organizerProfileId: string,
      inviteId: string,
      input: EventTeamVersionRequest,
    ) {
      return request(
        `/organizers/${organizerProfileId}/team/invites/${inviteId}`,
        accessToken,
        organizerTeamSummarySchema,
        { body: input, method: "DELETE" },
      );
    },
    createDraftEvent(accessToken: string, input: CreateDraftEventRequest) {
      return request("/events", accessToken, commandResourceResponseSchema, {
        body: input,
        method: "POST",
      });
    },
    createOrganizer(accessToken: string, input: CreateOrganizerProfileRequest) {
      return request("/organizers", accessToken, commandResourceResponseSchema, {
        body: input,
        method: "POST",
      });
    },
    updateOrganizer(
      accessToken: string,
      organizerProfileId: string,
      input: UpdateOrganizerProfileRequest,
    ) {
      return request(
        `/organizers/${organizerProfileId}`,
        accessToken,
        organizerProfileDetailsSchema,
        { body: input, method: "PUT" },
      );
    },
    updateDraftEventDetails(
      accessToken: string,
      eventId: string,
      input: UpdateDraftEventDetailsRequest,
    ) {
      return request(`/events/${eventId}/details`, accessToken, eventDetailsResultSchema, {
        body: input,
        method: "PUT",
      });
    },
    duplicateEvent(accessToken: string, eventId: string, input: DuplicateEventRequest) {
      return request(`/events/${eventId}/duplicate`, accessToken, commandResourceResponseSchema, {
        body: input,
        method: "POST",
      });
    },
    getEventForSeller(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/seller-view`, accessToken, eventForSellerSchema);
    },
    applyToEvent(accessToken: string, eventId: string, input: ApplyToEventRequest) {
      return request(`/events/${eventId}/participation`, accessToken, sellerParticipationSchema, {
        body: input,
        method: "POST",
      });
    },
    listMyParticipations(accessToken: string) {
      return request("/participations", accessToken, myParticipationsSchema);
    },
    withdrawParticipation(accessToken: string, participationId: string, expectedVersion: number) {
      return request(
        `/participations/${participationId}/withdraw`,
        accessToken,
        sellerParticipationSchema,
        { body: { expectedVersion }, method: "POST" },
      );
    },
    listEventSellers(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/sellers`, accessToken, eventSellersSchema);
    },
    decideSeller(accessToken: string, participationId: string, input: DecideSellerRequest) {
      return request(
        `/participations/${participationId}/decision`,
        accessToken,
        sellerParticipationSchema,
        { body: input, method: "POST" },
      );
    },
    updateEventAdmission(accessToken: string, eventId: string, input: UpdateEventAdmissionRequest) {
      return request(`/events/${eventId}/admission`, accessToken, eventSellersSchema, {
        body: input,
        method: "PUT",
      });
    },
    publishEvent(accessToken: string, eventId: string, expectedEventVersion: number) {
      return request(`/events/${eventId}/publish`, accessToken, eventLifecycleResultSchema, {
        body: { expectedEventVersion },
        method: "POST",
      });
    },
    cancelEvent(accessToken: string, eventId: string, input: CancelEventRequest) {
      return request(`/events/${eventId}/cancel`, accessToken, eventLifecycleResultSchema, {
        body: input,
        method: "POST",
      });
    },
    endEventEarly(accessToken: string, eventId: string, expectedEventVersion: number) {
      return request(`/events/${eventId}/end-early`, accessToken, eventLifecycleResultSchema, {
        body: { expectedEventVersion },
        method: "POST",
      });
    },
    deleteDraftEvent(accessToken: string, eventId: string, input: DeleteDraftEventRequest) {
      return request(`/events/${eventId}`, accessToken, commandResourceResponseSchema, {
        body: input,
        method: "DELETE",
      });
    },
    enrollRecoveryCode(accessToken: string, input: EnrollRecoveryCodeRequest) {
      return request("/account/recovery-code", accessToken, recoveryCodeEnrollmentResponseSchema, {
        body: input,
        method: "POST",
      });
    },
    getOrganizerVerification(accessToken: string, organizerProfileId: string) {
      return request(
        `/organizers/${organizerProfileId}/verification`,
        accessToken,
        organizerVerificationStatusSchema,
      );
    },
    requestOrganizerVerification(
      accessToken: string,
      organizerProfileId: string,
      input: RequestOrganizerVerificationRequest,
    ) {
      return request(
        `/organizers/${organizerProfileId}/verification`,
        accessToken,
        organizerVerificationStatusSchema,
        { body: input, method: "POST" },
      );
    },
    listOrganizerVerifications(accessToken: string) {
      return request(
        "/admin/organizer-verifications",
        accessToken,
        organizerVerificationQueueSchema,
      );
    },
    decideOrganizerVerification(
      accessToken: string,
      organizerProfileId: string,
      input: DecideOrganizerVerificationRequest,
    ) {
      return request(
        `/admin/organizer-verifications/${organizerProfileId}/decision`,
        accessToken,
        adminStatusSchema,
        { body: input, method: "POST" },
      );
    },
    getMfaStatus(accessToken: string) {
      return request("/account/mfa", accessToken, mfaStatusSchema);
    },
    enrollTotp(accessToken: string) {
      return request("/account/mfa/totp", accessToken, totpEnrollmentSchema, {
        body: {},
        method: "POST",
      });
    },
    removeTotp(accessToken: string) {
      return request("/account/mfa/totp/remove", accessToken, mfaStatusSchema, {
        body: {},
        method: "POST",
      });
    },
    getAccountDeletion(accessToken: string) {
      return request("/account/deletion", accessToken, accountDeletionStatusSchema);
    },
    requestAccountDeletion(accessToken: string, input: RequestAccountDeletionRequest) {
      return request("/account/deletion", accessToken, accountDeletionStatusSchema, {
        body: input,
        method: "POST",
      });
    },
    cancelAccountDeletion(accessToken: string) {
      return request("/account/deletion/cancel", accessToken, accountDeletionStatusSchema, {
        method: "POST",
      });
    },
    getAccountRecoveryStatus(accessToken: string) {
      return request("/account/recovery-code", accessToken, accountRecoveryStatusSchema);
    },
    getDashboard(accessToken: string): Promise<IdentityDashboard> {
      return request("/dashboard", accessToken, identityDashboardSchema);
    },
    getEventTeam(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/team`, accessToken, eventTeamSummarySchema);
    },
    getFirstEventReview(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/first-review`, accessToken, firstEventReviewStatusSchema);
    },
    requestFirstEventReview(accessToken: string, eventId: string, expectedEventVersion: number) {
      return request(
        `/events/${eventId}/first-review`,
        accessToken,
        eventPublicationReadinessSchema,
        {
          body: { expectedEventVersion },
          method: "POST",
        },
      );
    },
    getAdminStatus(accessToken: string) {
      return request("/admin/status", accessToken, adminStatusSchema);
    },
    startAdminElevation(accessToken: string, code: string) {
      return request("/admin/elevation", accessToken, adminStatusSchema, {
        body: { code },
        method: "POST",
      });
    },
    endAdminElevation(accessToken: string) {
      return request("/admin/elevation/end", accessToken, adminStatusSchema, {
        body: {},
        method: "POST",
      });
    },
    getAdminEvent(accessToken: string, eventId: string) {
      return request(`/admin/events/${eventId}`, accessToken, adminEventSummarySchema);
    },
    interveneInEvent(accessToken: string, eventId: string, input: AdminEventInterventionRequest) {
      return request(
        `/admin/events/${eventId}/intervention`,
        accessToken,
        eventLifecycleResultSchema,
        { body: input, method: "POST" },
      );
    },
    listFirstEventReviews(accessToken: string) {
      return request("/admin/reviews", accessToken, firstEventReviewQueueSchema);
    },
    decideFirstEventReview(
      accessToken: string,
      eventId: string,
      input: DecideFirstEventReviewRequest,
    ) {
      return request(`/admin/reviews/${eventId}/decision`, accessToken, adminStatusSchema, {
        body: input,
        method: "POST",
      });
    },
    getEventPublicationReadiness(accessToken: string, eventId: string) {
      return request(
        `/events/${eventId}/publication-readiness`,
        accessToken,
        eventPublicationReadinessSchema,
      );
    },
    getIncomingEventTeamInvites(accessToken: string) {
      return request("/team-invites", accessToken, incomingEventTeamInvitesSchema);
    },
    getIncomingOrganizerInvites(accessToken: string) {
      return request("/organizer-invites", accessToken, incomingOrganizerInvitesSchema);
    },
    getOrganizerTeam(accessToken: string, organizerProfileId: string) {
      return request(
        `/organizers/${organizerProfileId}/team`,
        accessToken,
        organizerTeamSummarySchema,
      );
    },
    inviteEventTeamMember(
      accessToken: string,
      eventId: string,
      input: InviteEventTeamMemberRequest,
    ) {
      return request(`/events/${eventId}/team/invites`, accessToken, eventTeamSummarySchema, {
        body: input,
        method: "POST",
      });
    },
    inviteOrganizerManager(
      accessToken: string,
      organizerProfileId: string,
      input: InviteOrganizerManagerRequest,
    ) {
      return request(
        `/organizers/${organizerProfileId}/team/invites`,
        accessToken,
        organizerTeamSummarySchema,
        { body: input, method: "POST" },
      );
    },
    initiateEventOwnershipTransfer(
      accessToken: string,
      eventId: string,
      input: InitiateEventOwnershipTransferRequest,
    ) {
      return request(
        `/events/${eventId}/team/ownership-transfers`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "POST" },
      );
    },
    initiateEmergencySuccessorClaim(
      accessToken: string,
      eventId: string,
      input: EventTeamVersionRequest,
    ) {
      return request(
        `/events/${eventId}/team/emergency-successor-claims`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "POST" },
      );
    },
    acceptEventOwnershipTransfer(
      accessToken: string,
      eventId: string,
      transferId: string,
      input: EventTeamVersionRequest,
    ) {
      return request(
        `/events/${eventId}/team/ownership-transfers/${transferId}/accept`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "POST" },
      );
    },
    completeEmergencySuccessorClaim(
      accessToken: string,
      eventId: string,
      claimId: string,
      input: EventTeamVersionRequest,
    ) {
      return request(
        `/events/${eventId}/team/emergency-successor-claims/${claimId}/complete`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "POST" },
      );
    },
    removeEventTeamMember(
      accessToken: string,
      eventId: string,
      membershipId: string,
      input: EventTeamVersionRequest,
    ) {
      return request(
        `/events/${eventId}/team/members/${membershipId}`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "DELETE" },
      );
    },
    removeOrganizerManager(
      accessToken: string,
      organizerProfileId: string,
      membershipId: string,
      input: EventTeamVersionRequest,
    ) {
      return request(
        `/organizers/${organizerProfileId}/team/members/${membershipId}`,
        accessToken,
        organizerTeamSummarySchema,
        { body: input, method: "DELETE" },
      );
    },
    clearEventEmergencySuccessor(
      accessToken: string,
      eventId: string,
      input: EventTeamVersionRequest,
    ) {
      return request(
        `/events/${eventId}/team/emergency-successor`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "DELETE" },
      );
    },
    saveEventBoundary(accessToken: string, eventId: string, input: SaveEventBoundaryRequest) {
      return request(`/events/${eventId}/boundary`, accessToken, eventBoundarySummarySchema, {
        body: input,
        method: "PUT",
      });
    },
    saveEventRegistration(
      accessToken: string,
      eventId: string,
      input: SaveEventRegistrationRequest,
    ) {
      return request(
        `/events/${eventId}/registration`,
        accessToken,
        eventRegistrationSummarySchema,
        {
          body: input,
          method: "PUT",
        },
      );
    },
    setEventEmergencySuccessor(
      accessToken: string,
      eventId: string,
      input: SetEmergencySuccessorRequest,
    ) {
      return request(
        `/events/${eventId}/team/emergency-successor`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "PUT" },
      );
    },
    attestEventPublication(
      accessToken: string,
      eventId: string,
      input: AttestEventPublicationRequest,
    ) {
      return request(
        `/events/${eventId}/publication-attestation`,
        accessToken,
        eventPublicationReadinessSchema,
        { body: input, method: "POST" },
      );
    },
    updateProfile(accessToken: string, input: UpdateProfileRequest) {
      return request("/profile", accessToken, identityDashboardSchema.shape.profile, {
        body: input,
        method: "PUT",
      });
    },
    updateDraftEventVisibility(
      accessToken: string,
      eventId: string,
      input: UpdateDraftEventVisibilityRequest,
    ) {
      return request(`/events/${eventId}/visibility`, accessToken, eventControlSummarySchema, {
        body: input,
        method: "PUT",
      });
    },
    updateEventTeamMemberRole(
      accessToken: string,
      eventId: string,
      membershipId: string,
      input: UpdateEventTeamMemberRoleRequest,
    ) {
      return request(
        `/events/${eventId}/team/members/${membershipId}`,
        accessToken,
        eventTeamSummarySchema,
        { body: input, method: "PUT" },
      );
    },
  };
}
