import {
  type AcceptEventTeamInviteRequest,
  type AccountRecoveryTokenRequest,
  type AdminEventInterventionRequest,
  type ApplyToEventRequest,
  type AttestEventPublicationRequest,
  accountDeletionStatusSchema,
  accountRecoveryClaimSchema,
  accountRecoveryCompletionSchema,
  accountRecoveryStatusSchema,
  adminAccountSchema,
  adminApprovalsSchema,
  adminCasesSchema,
  adminEventSummarySchema,
  adminStatusSchema,
  apiErrorSchema,
  appealQueueSchema,
  type CancelEventRequest,
  type ChangeParticipationAddressRequest,
  type CreateDraftEventRequest,
  type CreateOrganizerProfileRequest,
  commandResourceResponseSchema,
  type DecideFirstEventReviewRequest,
  type DecideOrganizerVerificationRequest,
  type DecideSellerRequest,
  type DeleteDraftEventRequest,
  type DuplicateEventRequest,
  type EnrollRecoveryCodeRequest,
  type EventTeamVersionRequest,
  eventBoundarySummarySchema,
  eventControlSummarySchema,
  eventDetailsResultSchema,
  eventForSellerSchema,
  eventLifecycleResultSchema,
  eventPublicationReadinessSchema,
  eventPublicLinkSchema,
  type ContactOrganizerRequest,
  contactStartedSchema,
  eventExportCreatedSchema,
  relayThreadSchema,
  relayThreadsSchema,
  accountNotificationsSchema,
  notificationPreferencesSchema,
  type AddRoutingOverrideRequest,
  eventRoutingSchema,
  routingPackageSchema,
  earlyLocationVisibilitySchema,
  publicEventManifestSchema,
  publicSafetyFeedSchema,
  publicSnapshotSchema,
  eventRegistrationSummarySchema,
  eventSellersSchema,
  eventTaxonomySchema,
  eventTeamSummarySchema,
  firstEventReviewQueueSchema,
  firstEventReviewStatusSchema,
  type GeocodeRequest,
  geocodeResultSchema,
  type IdentityDashboard,
  type InitiateAccountRecoveryRequest,
  type InitiateEventOwnershipTransferRequest,
  type InviteEventTeamMemberRequest,
  type InviteOrganizerManagerRequest,
  identityDashboardSchema,
  incomingEventTeamInvitesSchema,
  incomingOrganizerInvitesSchema,
  incomingSellerInvitesSchema,
  initiateAccountRecoveryResponseSchema,
  type LocationReviewRequest,
  type ModerateParticipationRequest,
  mfaStatusSchema,
  moderationCasesSchema,
  myModerationSchema,
  myParticipationsSchema,
  organizerProfileDetailsSchema,
  organizerTeamSummarySchema,
  organizerVerificationQueueSchema,
  organizerVerificationStatusSchema,
  type PinCorrectionRequest,
  type PostponeEventRequest,
  publicEventListSchema,
  publicEventSummarySchema,
  publicOrganizerPageSchema,
  publicSitemapSchema,
  type RequestAccountDeletionRequest,
  type RequestOrganizerVerificationRequest,
  type RescheduleEventRequest,
  type RotateUnlistedLinkRequest,
  recoveryCodeEnrollmentResponseSchema,
  reportContactSchema,
  reportReceivedSchema,
  restrictionLiftResultSchema,
  type SaveEventBoundaryRequest,
  type SaveEventRegistrationRequest,
  type SaveEventTaxonomyRequest,
  type SaveSellerListingRequest,
  type SetEmergencySuccessorRequest,
  type SetLiveStatusRequest,
  type SubmitReportRequest,
  type SubmitPublicReportRequest,
  sellerInvitesSchema,
  sellerListingSchema,
  sellerParticipationSchema,
  totpEnrollmentSchema,
  type UpdateDraftEventDetailsRequest,
  type UpdateDraftEventVisibilityRequest,
  type UpdateEventAdmissionRequest,
  type UpdateEventTeamMemberRoleRequest,
  type UpdateOrganizerProfileRequest,
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

  // Anonymous calls; without a body this is a GET of a public page resource.
  async function publicRequest<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const response = await fetch(
      `${config.baseUrl}${config.browserSession ? "" : "/functions/v1/api-v1"}${path}`,
      {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: config.browserSession
          ? { "x-promenadis-browser": "1", "content-type": "application/json" }
          : { apikey: config.publishableKey ?? "", "content-type": "application/json" },
        credentials: config.browserSession ? "same-origin" : "omit",
        cache: "no-store",
        method: body === undefined ? "GET" : "POST",
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
    geocodeAddress(accessToken: string, eventId: string, input: GeocodeRequest) {
      return request(`/events/${eventId}/geocode`, accessToken, geocodeResultSchema, {
        body: input,
        method: "POST",
      });
    },
    changeParticipationAddress(
      accessToken: string,
      participationId: string,
      input: ChangeParticipationAddressRequest,
    ) {
      return request(
        `/participations/${participationId}/address`,
        accessToken,
        sellerParticipationSchema,
        { body: input, method: "POST" },
      );
    },
    reviewEventLocation(accessToken: string, eventId: string, input: LocationReviewRequest) {
      return request(`/events/${eventId}/location-review`, accessToken, eventSellersSchema, {
        body: input,
        method: "POST",
      });
    },
    correctLocationPin(accessToken: string, locationId: string, input: PinCorrectionRequest) {
      return request(`/locations/${locationId}/pin-correction`, accessToken, eventSellersSchema, {
        body: input,
        method: "POST",
      });
    },
    getEventTaxonomy(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/taxonomy`, accessToken, eventTaxonomySchema);
    },
    saveEventTaxonomy(accessToken: string, eventId: string, input: SaveEventTaxonomyRequest) {
      return request(`/events/${eventId}/taxonomy`, accessToken, eventTaxonomySchema, {
        body: input,
        method: "PUT",
      });
    },
    getSellerListing(accessToken: string, participationId: string) {
      return request(
        `/participations/${participationId}/listing`,
        accessToken,
        sellerListingSchema,
      );
    },
    saveSellerListing(
      accessToken: string,
      participationId: string,
      input: SaveSellerListingRequest,
    ) {
      return request(
        `/participations/${participationId}/listing`,
        accessToken,
        sellerListingSchema,
        {
          body: input,
          method: "PUT",
        },
      );
    },
    setSellerLiveStatus(accessToken: string, participationId: string, input: SetLiveStatusRequest) {
      return request(
        `/participations/${participationId}/live-status`,
        accessToken,
        sellerListingSchema,
        { body: input, method: "POST" },
      );
    },
    getPublicEvent(route: "public" | "unlisted", key: string) {
      return publicRequest(
        `/public/${route === "public" ? "events" : "unlisted"}/${key}`,
        publicEventSummarySchema,
      );
    },
    listPublicEvents(input: { query?: string; liveOnly?: boolean; after?: string | null }) {
      const params = new URLSearchParams();
      if (input.query) params.set("q", input.query);
      if (input.liveOnly) params.set("live", "1");
      if (input.after) params.set("after", input.after);
      const search = params.toString();
      return publicRequest(`/public/events${search ? `?${search}` : ""}`, publicEventListSchema);
    },
    getPublicOrganizer(key: string) {
      return publicRequest(`/public/organizers/${key}`, publicOrganizerPageSchema);
    },
    getPublicManifest(route: "public" | "unlisted", key: string) {
      return publicRequest(
        `/public/${route === "public" ? "events" : "unlisted"}/${key}/manifest`,
        publicEventManifestSchema,
      );
    },
    getPublicSafetyFeed(route: "public" | "unlisted", key: string) {
      return publicRequest(
        `/public/${route === "public" ? "events" : "unlisted"}/${key}/safety`,
        publicSafetyFeedSchema,
      );
    },
    getPublicSnapshot(snapshotId: string) {
      return publicRequest(`/public/snapshots/${snapshotId}`, publicSnapshotSchema);
    },
    setEarlyLocationVisibility(
      accessToken: string,
      eventId: string,
      input: { expectedEventVersion: number; visible: boolean },
    ) {
      return request(
        `/events/${eventId}/early-location-visibility`,
        accessToken,
        earlyLocationVisibilitySchema,
        { body: input, method: "PUT" },
      );
    },
    getPublicRoutingPackage(packageId: string) {
      return publicRequest(`/public/routing/${packageId}`, routingPackageSchema);
    },
    getEventRouting(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/routing`, accessToken, eventRoutingSchema);
    },
    buildEventRouting(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/routing/builds`, accessToken, eventRoutingSchema, {
        method: "POST",
      });
    },
    confirmRoutingBuild(accessToken: string, eventId: string, buildId: string) {
      return request(
        `/events/${eventId}/routing/builds/${buildId}/confirm`,
        accessToken,
        eventRoutingSchema,
        { method: "POST" },
      );
    },
    getRoutingPreviewPackage(accessToken: string, eventId: string, buildId: string) {
      return request(
        `/events/${eventId}/routing/builds/${buildId}/package`,
        accessToken,
        routingPackageSchema,
      );
    },
    addRoutingOverride(accessToken: string, eventId: string, input: AddRoutingOverrideRequest) {
      return request(`/events/${eventId}/routing/overrides`, accessToken, eventRoutingSchema, {
        body: input,
        method: "POST",
      });
    },
    removeRoutingOverride(accessToken: string, eventId: string, overrideId: string) {
      return request(
        `/events/${eventId}/routing/overrides/${overrideId}`,
        accessToken,
        eventRoutingSchema,
        { method: "DELETE" },
      );
    },
    listNotifications(accessToken: string) {
      return request("/notifications", accessToken, accountNotificationsSchema);
    },
    markNotificationsRead(accessToken: string, notificationId?: string) {
      return request("/notifications/read", accessToken, accountNotificationsSchema, {
        body: notificationId ? { notificationId } : {},
        method: "POST",
      });
    },
    getNotificationPreferences(accessToken: string) {
      return request(
        "/account/notification-preferences",
        accessToken,
        notificationPreferencesSchema,
      );
    },
    setNotificationPreferences(accessToken: string, eventReminders: boolean) {
      return request(
        "/account/notification-preferences",
        accessToken,
        notificationPreferencesSchema,
        {
          body: { eventReminders },
          method: "PUT",
        },
      );
    },
    contactOrganizer(route: "public" | "unlisted", key: string, input: ContactOrganizerRequest) {
      return publicRequest(
        `/public/${route === "public" ? "events" : "unlisted"}/${key}/contact`,
        contactStartedSchema,
        input,
      );
    },
    readContactThread(threadId: string, token: string) {
      return publicRequest(`/contact/${threadId}`, relayThreadSchema, { token });
    },
    replyContactThread(threadId: string, token: string, message: string) {
      return publicRequest(`/contact/${threadId}/reply`, relayThreadSchema, { message, token });
    },
    listEventMessages(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/messages`, accessToken, relayThreadsSchema);
    },
    replyEventMessage(accessToken: string, eventId: string, threadId: string, message: string) {
      return request(
        `/events/${eventId}/messages/${threadId}/reply`,
        accessToken,
        relayThreadSchema,
        {
          body: { message },
          method: "POST",
        },
      );
    },
    createEventExport(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/exports`, accessToken, eventExportCreatedSchema, {
        method: "POST",
      });
    },
    /** Returns the CSV text; the export can be downloaded once. */
    async downloadEventExport(
      accessToken: string,
      eventId: string,
      exportId: string,
      token: string,
    ) {
      const response = await fetch(
        `${config.baseUrl}${config.browserSession ? "" : "/functions/v1/api-v1"}/events/${eventId}/exports/${exportId}/download`,
        {
          body: JSON.stringify({ token }),
          cache: "no-store",
          credentials: config.browserSession ? "same-origin" : "omit",
          headers: config.browserSession
            ? {
                "content-type": "application/json",
                "x-account-id": accessToken,
                "x-promenadis-browser": "1",
              }
            : {
                apikey: config.publishableKey ?? "",
                authorization: `Bearer ${accessToken}`,
                "content-type": "application/json",
              },
          method: "POST",
        },
      );
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
        throw new PromenadisApiError(
          parsed.success ? parsed.data.message : "The request failed.",
          response.status,
          parsed.success ? parsed.data.code : "request_failed",
          parsed.success ? parsed.data.correlationId : response.headers.get("x-correlation-id"),
        );
      }
      return response.text();
    },
    getPublicSitemap() {
      return publicRequest("/public/sitemap", publicSitemapSchema);
    },
    getEventPublicLink(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/public-link`, accessToken, eventPublicLinkSchema);
    },
    rotateUnlistedLink(accessToken: string, eventId: string, input: RotateUnlistedLinkRequest) {
      return request(
        `/events/${eventId}/unlisted-link/rotate`,
        accessToken,
        eventPublicLinkSchema,
        {
          body: input,
          method: "POST",
        },
      );
    },
    submitReport(input: SubmitReportRequest) {
      return publicRequest("/reports", reportReceivedSchema, input);
    },
    submitPublicReport(input: SubmitPublicReportRequest) {
      return publicRequest("/reports/public", reportReceivedSchema, input);
    },
    listEventCases(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/cases`, accessToken, moderationCasesSchema);
    },
    reviewCase(
      accessToken: string,
      caseId: string,
      input: { decision: "restore" | "uphold" | "dismiss"; reason: string },
    ) {
      return request(`/cases/${caseId}/review`, accessToken, moderationCasesSchema, {
        body: input,
        method: "POST",
      });
    },
    moderateParticipation(
      accessToken: string,
      participationId: string,
      input: ModerateParticipationRequest,
    ) {
      return request(
        `/participations/${participationId}/moderation`,
        accessToken,
        sellerParticipationSchema,
        { body: input, method: "POST" },
      );
    },
    listMyModeration(accessToken: string) {
      return request("/moderation", accessToken, myModerationSchema);
    },
    submitAppeal(accessToken: string, actionId: string, statement: string) {
      return request(`/moderation/${actionId}/appeal`, accessToken, myModerationSchema, {
        body: { statement },
        method: "POST",
      });
    },
    listAppeals(accessToken: string) {
      return request("/admin/appeals", accessToken, appealQueueSchema);
    },
    decideAppeal(
      accessToken: string,
      appealId: string,
      input: { decision: "uphold" | "reverse"; reason: string },
    ) {
      return request(`/admin/appeals/${appealId}/decision`, accessToken, appealQueueSchema, {
        body: input,
        method: "POST",
      });
    },
    findAccount(accessToken: string, input: { email: string; reason: string }) {
      return request("/admin/accounts/lookup", accessToken, adminAccountSchema, {
        body: input,
        method: "POST",
      });
    },
    restrictAccount(accessToken: string, accountId: string, reason: string) {
      return request(`/admin/accounts/${accountId}/restrict`, accessToken, adminAccountSchema, {
        body: { reason },
        method: "POST",
      });
    },
    liftRestriction(accessToken: string, restrictionId: string, reason: string) {
      return request(
        `/admin/restrictions/${restrictionId}/lift`,
        accessToken,
        restrictionLiftResultSchema,
        { body: { reason }, method: "POST" },
      );
    },
    listAdminApprovals(accessToken: string) {
      return request("/admin/approvals", accessToken, adminApprovalsSchema);
    },
    decideAdminApproval(accessToken: string, approvalId: string, approve: boolean) {
      return request(`/admin/approvals/${approvalId}/decision`, accessToken, adminApprovalsSchema, {
        body: { approve },
        method: "POST",
      });
    },
    listAdminCases(accessToken: string) {
      return request("/admin/cases", accessToken, adminCasesSchema);
    },
    readReportContact(accessToken: string, reportId: string, reason: string) {
      return request(`/admin/reports/${reportId}/contact`, accessToken, reportContactSchema, {
        body: { reason },
        method: "POST",
      });
    },
    listSellerInvites(accessToken: string, eventId: string) {
      return request(`/events/${eventId}/seller-invites`, accessToken, sellerInvitesSchema);
    },
    inviteSeller(accessToken: string, eventId: string, email: string) {
      return request(`/events/${eventId}/seller-invites`, accessToken, sellerInvitesSchema, {
        body: { email },
        method: "POST",
      });
    },
    cancelSellerInvite(accessToken: string, inviteId: string) {
      return request(`/seller-invites/${inviteId}`, accessToken, sellerInvitesSchema, {
        body: {},
        method: "DELETE",
      });
    },
    listIncomingSellerInvites(accessToken: string) {
      return request("/seller-invites", accessToken, incomingSellerInvitesSchema);
    },
    acceptSellerInvite(accessToken: string, inviteId: string, input: ApplyToEventRequest) {
      return request(`/seller-invites/${inviteId}/accept`, accessToken, sellerParticipationSchema, {
        body: input,
        method: "POST",
      });
    },
    postponeEvent(accessToken: string, eventId: string, input: PostponeEventRequest) {
      return request(`/events/${eventId}/postpone`, accessToken, eventLifecycleResultSchema, {
        body: input,
        method: "POST",
      });
    },
    rescheduleEvent(accessToken: string, eventId: string, input: RescheduleEventRequest) {
      return request(`/events/${eventId}/reschedule`, accessToken, eventLifecycleResultSchema, {
        body: input,
        method: "POST",
      });
    },
    confirmReschedule(accessToken: string, participationId: string, accept: boolean) {
      return request(
        `/participations/${participationId}/reschedule-confirmation`,
        accessToken,
        sellerParticipationSchema,
        { body: { accept }, method: "POST" },
      );
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
