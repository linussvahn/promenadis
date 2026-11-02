import { createClient } from "@supabase/supabase-js";
import {
  acceptEventTeamInviteRequestSchema,
  accountDeletionStatusSchema,
  accountProfileSchema,
  accountRecoveryClaimSchema,
  accountRecoveryCompletionSchema,
  accountRecoveryStatusSchema,
  accountRecoveryTokenRequestSchema,
  adminAccountSchema,
  adminApprovalsSchema,
  adminCasesSchema,
  adminElevationRequestSchema,
  adminEventInterventionRequestSchema,
  adminEventSummarySchema,
  adminFindAccountRequestSchema,
  adminReasonRequestSchema,
  adminStatusSchema,
  appealQueueSchema,
  applyToEventRequestSchema,
  attestEventPublicationRequestSchema,
  cancelEventRequestSchema,
  changeParticipationAddressRequestSchema,
  commandResourceResponseSchema,
  confirmRescheduleRequestSchema,
  createDraftEventRequestSchema,
  createOrganizerProfileRequestSchema,
  decideAdminApprovalRequestSchema,
  decideAppealRequestSchema,
  decideFirstEventReviewSchema,
  decideOrganizerVerificationSchema,
  decideSellerRequestSchema,
  deleteDraftEventRequestSchema,
  duplicateEventRequestSchema,
  enrollRecoveryCodeRequestSchema,
  eventBoundarySummarySchema,
  eventControlSummarySchema,
  eventDetailsResultSchema,
  eventForSellerSchema,
  eventLifecycleResultSchema,
  eventPublicationReadinessSchema,
  eventPublicLinkSchema,
  adminOperationsSchema,
  eventFeedbackRequestSchema,
  eventFeedbackSummarySchema,
  killSwitchKeySchema,
  operationsStatusSchema,
  setKillSwitchRequestSchema,
  supportRequestSchema,
  supportRequestsSchema,
  contactOrganizerRequestSchema,
  contactStartedSchema,
  eventExportCreatedSchema,
  relayTeamReplySchema,
  relayThreadSchema,
  relayThreadsSchema,
  relayTokenRequestSchema,
  relayVisitorReplySchema,
  accountNotificationsSchema,
  markNotificationsReadRequestSchema,
  notificationPreferencesSchema,
  addRoutingOverrideRequestSchema,
  eventRoutingSchema,
  earlyLocationVisibilitySchema,
  publicEventManifestSchema,
  publicSafetyFeedSchema,
  publicSnapshotSchema,
  setEarlyLocationVisibilityRequestSchema,
  eventRegistrationSummarySchema,
  eventSellersSchema,
  eventTaxonomySchema,
  eventTeamSummarySchema,
  eventTeamVersionRequestSchema,
  firstEventReviewQueueSchema,
  firstEventReviewStatusSchema,
  geocodeRequestSchema,
  geocodeResultSchema,
  identityDashboardSchema,
  incomingEventTeamInvitesSchema,
  incomingOrganizerInvitesSchema,
  incomingSellerInvitesSchema,
  initiateAccountRecoveryRequestSchema,
  initiateAccountRecoveryResponseSchema,
  initiateEventOwnershipTransferRequestSchema,
  inviteEventTeamMemberRequestSchema,
  inviteOrganizerManagerRequestSchema,
  inviteSellerRequestSchema,
  locationReviewRequestSchema,
  mfaStatusSchema,
  moderateParticipationRequestSchema,
  moderationCasesSchema,
  myModerationSchema,
  myParticipationsSchema,
  organizerProfileDetailsSchema,
  organizerTeamSummarySchema,
  organizerVerificationQueueSchema,
  organizerVerificationStatusSchema,
  participationVersionRequestSchema,
  pinCorrectionRequestSchema,
  postponeEventRequestSchema,
  publicEventListSchema,
  publicEventSummarySchema,
  publicOrganizerPageSchema,
  publicSitemapSchema,
  publishEventRequestSchema,
  readinessResponseSchema,
  recoveryCodeEnrollmentResponseSchema,
  reportContactSchema,
  requestAccountDeletionRequestSchema,
  requestFirstEventReviewSchema,
  requestOrganizerVerificationSchema,
  rescheduleEventRequestSchema,
  restrictionLiftResultSchema,
  reviewCaseRequestSchema,
  rotateUnlistedLinkRequestSchema,
  saveEventBoundaryRequestSchema,
  saveEventRegistrationRequestSchema,
  saveEventTaxonomyRequestSchema,
  saveSellerListingRequestSchema,
  sellerInvitesSchema,
  sellerListingSchema,
  sellerParticipationSchema,
  setEmergencySuccessorRequestSchema,
  setLiveStatusRequestSchema,
  submitAppealRequestSchema,
  submitReportRequestSchema,
  submitPublicReportRequestSchema,
  totpEnrollmentSchema,
  updateDraftEventDetailsRequestSchema,
  updateDraftEventVisibilityRequestSchema,
  updateEventAdmissionRequestSchema,
  updateEventTeamMemberRoleRequestSchema,
  updateOrganizerProfileRequestSchema,
  updateProfileRequestSchema,
} from "../../../packages/contracts/src/schemas.ts";
import { sessionFromVerifiedAccessToken } from "../../../packages/domain/src/auth-session.ts";
import { normalizeOrganizationNumber } from "../../../packages/domain/src/organization-number.ts";
import { createBrowserSessionGateway } from "./browser-sessions.ts";
import { configuredGeocoder, normalizedGeocodeKey } from "./geocoder.ts";
import { loadRoutingSource } from "./routing-source.ts";
import {
  buildRoutingPackage,
  COMPILER_VERSION,
  validateRoutingPackage,
} from "../../../packages/routing/src/build.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Required Supabase function environment is unavailable");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "DELETE, GET, POST, PUT, OPTIONS",
    "access-control-allow-origin": origin && allowedOrigins.has(origin) ? origin : "null",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function json(
  body: unknown,
  status: number,
  correlationId: string,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-correlation-id": correlationId,
      "x-content-type-options": "nosniff",
    },
  });
}

const noIndex = "noindex, nofollow, nosnippet, noimageindex";

// Anonymous public reads: short shared caching; unlisted resources are never
// indexed and never leak their URL through the referrer.
function publicJson(
  body: unknown,
  correlationId: string,
  origin: string | null,
  options: { readonly unlisted?: boolean } = {},
): Response {
  const response = json(body, 200, correlationId, origin);
  response.headers.set(
    "cache-control",
    options.unlisted ? "private, max-age=60" : "public, max-age=60, stale-while-revalidate=60",
  );
  if (options.unlisted) {
    response.headers.set("x-robots-tag", noIndex);
    response.headers.set("referrer-policy", "no-referrer");
  }
  return response;
}

function apiError(
  code: string,
  message: string,
  status: number,
  correlationId: string,
  origin: string | null,
): Response {
  return json(
    { code, correlationId, message, schemaVersion: "1.0" },
    status,
    correlationId,
    origin,
  );
}

function routePath(request: Request): string {
  const pathname = new URL(request.url).pathname;
  const marker = "/api-v1";
  const markerIndex = pathname.indexOf(marker);
  return markerIndex === -1 ? pathname : pathname.slice(markerIndex + marker.length) || "/";
}

interface AuthenticatedActor {
  readonly assuranceLevel: "aal1" | "aal2";
  readonly authenticatedAt: string | null;
  readonly id: string;
  readonly sessionId: string;
  readonly token: string;
  readonly totpFactors: ReadonlyArray<{ readonly id: string; readonly verified: boolean }>;
}

// Auth's own user API: factor operations run as the user, never as service role.
async function authAsUser(token: string, path: string, method: string, body?: unknown) {
  const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    method,
    headers: {
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

// Anonymous limits key on an HMAC of the client network prefix (IPv4 /24,
// IPv6 /48), never the raw address.
async function networkBucket(request: Request): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const prefix = forwarded.includes(":")
    ? forwarded.split(":").slice(0, 3).join(":")
    : forwarded.split(".").slice(0, 3).join(".");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`promenadis/report-network/v1/${serviceRoleKey}`),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(prefix || "unknown"),
  );
  return [...new Uint8Array(signature).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function authenticatedActor(request: Request): Promise<AuthenticatedActor | null> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (!token) {
    return null;
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const session = sessionFromVerifiedAccessToken(token, data.user.id);
  if (!session) return null;
  const { data: live, error: sessionError } = await admin.rpc("is_active_auth_session", {
    p_account_id: data.user.id,
    p_session_id: session.sessionId,
  });
  // A lookup outage must not turn into an authorization success.
  if (sessionError) throw new Error("session_validation_unavailable");
  if (live !== true) return null;
  const totpFactors = (data.user.factors ?? [])
    .filter((factor) => factor.factor_type === "totp")
    .map((factor) => ({ id: factor.id, verified: factor.status === "verified" }));
  return {
    assuranceLevel: session.assuranceLevel,
    authenticatedAt: session.authenticatedAt,
    id: data.user.id,
    sessionId: session.sessionId,
    token,
    totpFactors,
  };
}

async function requestBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 16_384) {
    throw new Error("request_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw new Error("request_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function generateRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const characters = Array.from(bytes, (byte) => alphabet[byte & 31]);
  return Array.from({ length: 5 }, (_, index) =>
    characters.slice(index * 4, index * 4 + 4).join(""),
  ).join("-");
}

function generateVerificationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

async function deliverLocalRecoveryVerification(email: string, link: string): Promise<boolean> {
  // No configurable remote transport: this slice is strictly local/synthetic.
  if (new URL(supabaseUrl).hostname !== "kong") return false;
  const deliveryUrl = "http://inbucket:8025/api/v1/send";
  try {
    const response = await fetch(deliveryUrl, {
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({
        From: { Email: "no-reply@promenadis.local", Name: "Promenadis" },
        HTML: `<p>Confirm the replacement email for your Promenadis account:</p><p><a href="${link.replace(/&/gu, "&amp;")}">Confirm replacement email</a></p><p>This link expires within seven days. Verification starts a minimum 24-hour waiting period. This local preview does not change account emails.</p>`,
        Subject: "Confirm your Promenadis recovery email",
        Text: `Confirm the replacement email for your Promenadis account:\n\n${link}\n\nThis link expires within seven days. Verification starts a minimum 24-hour waiting period. This local preview does not change account emails.`,
        To: [{ Email: email }],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
}

const teamCommandErrors = new Map<string, [string, string, number]>([
  [
    "Recent authentication required",
    ["recent_auth_required", "Sign in again before changing the event team.", 403],
  ],
  [
    "Only the event owner can manage the team",
    ["forbidden", "Only the event owner can manage the team.", 403],
  ],
  ["Actor is not an event team member", ["forbidden", "You cannot view this event team.", 403]],
  [
    "Event team version conflict",
    ["version_conflict", "The event team changed. Reload it and try again.", 409],
  ],
  ["Unsupported invited event role", ["invalid_role", "Choose a supported team role.", 400]],
  ["Unsupported event team role", ["invalid_role", "Choose a supported team role.", 400]],
  ["Invalid invitation email", ["invalid_email", "Enter a valid email address.", 400]],
  [
    "Account is already an event team member",
    ["already_member", "This account is already on the event team.", 409],
  ],
  ["Event invitation not found", ["not_found", "The invitation was not found.", 404]],
  [
    "Event invitation unavailable",
    ["invite_unavailable", "This invitation is invalid or has expired.", 410],
  ],
  [
    "Verified invited email required",
    ["verified_email_required", "Sign in with the verified invited email.", 403],
  ],
  [
    "Invalid event team display name",
    ["invalid_display_name", "Enter a display name for this event team.", 400],
  ],
  ["Event team member not found", ["not_found", "The team member was not found.", 404]],
  [
    "The event owner role requires ownership transfer",
    ["ownership_transfer_required", "Use ownership transfer to change the owner.", 409],
  ],
  [
    "The event owner cannot be removed",
    ["owner_required", "Every event must keep exactly one owner.", 409],
  ],
  [
    "Only the event owner can transfer ownership",
    ["forbidden", "Only the event owner can transfer ownership.", 403],
  ],
  [
    "An ownership transfer is already pending",
    ["transfer_pending", "Cancel the pending ownership transfer first.", 409],
  ],
  [
    "Ownership can only be transferred to a co-host",
    ["invalid_recipient", "Choose an eligible co-host.", 400],
  ],
  [
    "A verified co-host is required",
    ["verified_cohost_required", "The co-host must have a verified account.", 403],
  ],
  [
    "The co-host must manage the selected organizer",
    ["organizer_manager_required", "The co-host must already manage the selected organizer.", 409],
  ],
  [
    "Ownership transfer unavailable",
    ["transfer_unavailable", "This ownership transfer is invalid or has expired.", 410],
  ],
  [
    "Only the organizer owner can manage managers",
    ["forbidden", "Only the organizer owner can manage managers.", 403],
  ],
  ["Actor is not an organizer manager", ["forbidden", "You cannot view this organizer team.", 403]],
  [
    "Individual organizer identities cannot have managers",
    ["individual_organizer", "Personal organizer identities cannot have managers.", 409],
  ],
  [
    "Organizer team version conflict",
    ["version_conflict", "The organizer team changed. Reload it and try again.", 409],
  ],
  [
    "Account is already an organizer manager",
    ["already_member", "This account already manages the organizer.", 409],
  ],
  [
    "Organizer invitation unavailable",
    ["invite_unavailable", "This invitation is invalid or has expired.", 410],
  ],
  [
    "Invalid organizer team display name",
    ["invalid_display_name", "Enter a display name for this organizer team.", 400],
  ],
  ["Organizer manager not found", ["not_found", "The organizer manager was not found.", 404]],
  [
    "Only the event owner can designate a successor",
    ["forbidden", "Only the event owner can designate a successor.", 403],
  ],
  [
    "Emergency successor must be a co-host",
    ["invalid_recipient", "Choose an eligible co-host.", 400],
  ],
  [
    "A terminal event cannot have an emergency successor",
    ["invalid_state", "This event can no longer have an emergency successor.", 409],
  ],
  ["Emergency successor not found", ["not_found", "No emergency successor is set.", 404]],
  [
    "Only the designated successor can start a claim",
    ["forbidden", "Only the designated successor can start this claim.", 403],
  ],
  [
    "Only the owner or designated successor can cancel the claim",
    ["forbidden", "Only the owner or designated successor can cancel this claim.", 403],
  ],
  [
    "An emergency successor claim is already pending",
    ["claim_pending", "An emergency successor claim is already pending.", 409],
  ],
  [
    "Emergency successor claim unavailable",
    ["claim_unavailable", "This emergency successor claim is invalid or has expired.", 410],
  ],
  [
    "Emergency successor claim is not ready",
    ["claim_not_ready", "The 24-hour waiting period has not ended.", 409],
  ],
  [
    "Emergency successor designation is no longer valid",
    ["claim_unavailable", "The emergency successor designation is no longer valid.", 410],
  ],
  [
    "A terminal event cannot be claimed",
    ["invalid_state", "This event can no longer be claimed.", 409],
  ],
]);

const browserGateway = createBrowserSessionGateway({
  admin,
  url: supabaseUrl,
  publicKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  localEncryptionSeed: serviceRoleKey,
  origins: allowedOrigins,
  readBody: requestBody,
});

Deno.serve(async (request) => {
  const startedAt = performance.now();
  const correlationId = crypto.randomUUID();
  const origin = request.headers.get("origin");
  let route = routePath(request);
  let operation = "api.unknown";
  let status = "failed";

  try {
    if (origin && !allowedOrigins.has(origin)) {
      operation = "api.origin_denied";
      status = "denied";
      return apiError("origin_denied", "This origin is not allowed.", 403, correlationId, origin);
    }

    if (request.method === "OPTIONS") {
      status = "succeeded";
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (route.startsWith("/browser/")) {
      operation = "browser.session";
      route = route.slice("/browser".length);
      const bridged = await browserGateway(request, route, correlationId);
      if (bridged instanceof Response) {
        status = bridged.ok ? "succeeded" : "denied";
        return bridged;
      }
      request = bridged;
    }

    if (request.method === "GET" && route === "/health") {
      operation = "readiness.check";
      const response = readinessResponseSchema.parse({
        generatedAt: new Date().toISOString(),
        revision: Deno.env.get("DENO_DEPLOYMENT_ID") ?? "local",
        schemaVersion: "1.0",
        status: "ok",
      });
      status = "succeeded";
      return json(response, 200, correlationId, origin);
    }

    if (route === "/account-recovery" || route.startsWith("/account-recovery/")) {
      // Explicit fail-closed boundary: remote delivery and hosted recovery are not ready.
      if (new URL(supabaseUrl).hostname !== "kong") {
        status = "denied";
        return apiError(
          "recovery_unavailable",
          "Recovery is available only in the local preview.",
          503,
          correlationId,
          origin,
        );
      }
      if (request.method !== "POST") {
        status = "denied";
        return apiError(
          "recovery_unavailable",
          "Use POST for account recovery.",
          405,
          correlationId,
          origin,
        );
      }
      const { data: allowed, error: limitError } = await admin.rpc(
        "consume_local_recovery_budget_command",
      );
      if (limitError) throw limitError;
      if (allowed !== true) {
        status = "denied";
        return apiError("rate_limited", "Try again later.", 429, correlationId, origin);
      }
    }

    if (request.method === "POST" && route === "/account-recovery") {
      operation = "account.recovery_claim_initiate";
      const input = initiateAccountRecoveryRequestSchema.safeParse(await requestBody(request));
      if (
        !input.success ||
        input.data.currentEmail.toLowerCase() === input.data.newEmail.toLowerCase()
      ) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Check the recovery details.",
          400,
          correlationId,
          origin,
        );
      }
      const verificationToken = generateVerificationToken();
      const { data, error } = await admin.rpc("initiate_account_recovery_claim_command", {
        p_correlation_id: correlationId,
        p_current_email: input.data.currentEmail,
        p_new_email: input.data.newEmail,
        p_recovery_code: "recoveryCode" in input.data ? input.data.recoveryCode : null,
        p_totp_code: "totpCode" in input.data ? input.data.totpCode : null,
        p_verification_token: verificationToken,
      });
      // A wrong authenticator code is returned (so its attempt count commits),
      // and answered exactly like a wrong recovery code.
      if (error || (data && typeof data === "object" && "error" in data)) {
        status = "denied";
        const pending = error?.message === "Recovery claim already pending";
        return apiError(
          pending ? "claim_pending" : "invalid_recovery",
          pending
            ? "A verified recovery request is already waiting."
            : "The recovery request could not be started.",
          pending ? 409 : 400,
          correlationId,
          origin,
        );
      }
      const claim = accountRecoveryClaimSchema.safeParse(data);
      if (!claim.success) throw new Error("invalid_internal_response");
      const link = `${origin ?? "http://127.0.0.1:5173"}/recover-account#claim=${claim.data.id}&token=${verificationToken}`;
      const captured = await deliverLocalRecoveryVerification(input.data.newEmail, link);
      if (!captured) {
        status = "degraded";
        return apiError(
          "delivery_unavailable",
          "Local email delivery failed. Start again to resend.",
          503,
          correlationId,
          origin,
        );
      }
      const { error: deliveryError } = await admin.rpc(
        "complete_recovery_verification_delivery_command",
        {
          p_claim_id: claim.data.id,
        },
      );
      if (deliveryError) throw deliveryError;
      const parsed = initiateAccountRecoveryResponseSchema.safeParse({
        ...claim.data,
        delivery: "captured_locally",
      });
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = captured ? "succeeded" : "degraded";
      return json(parsed.data, 201, correlationId, origin);
    }

    const publicRecoveryRoute = route.match(
      /^\/account-recovery\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(verify|status|complete)$/iu,
    );
    if (request.method === "POST" && publicRecoveryRoute) {
      const input = accountRecoveryTokenRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "claim_unavailable",
          "This recovery link is invalid or expired.",
          410,
          correlationId,
          origin,
        );
      }
      if (publicRecoveryRoute[2] === "verify") {
        operation = "account.recovery_email_verify";
        const { data, error } = await admin.rpc("confirm_account_recovery_email_command", {
          p_claim_id: publicRecoveryRoute[1],
          p_correlation_id: correlationId,
          p_verification_token: input.data.verificationToken,
        });
        if (error) {
          status = "denied";
          return apiError(
            "claim_unavailable",
            "This recovery link is invalid or expired.",
            410,
            correlationId,
            origin,
          );
        }
        const parsed = accountRecoveryClaimSchema.safeParse(data);
        if (!parsed.success) throw new Error("invalid_internal_response");
        status = "succeeded";
        return json(parsed.data, 200, correlationId, origin);
      }
      if (publicRecoveryRoute[2] === "status") {
        // Read-only: lets a reopened link skip repeat verification.
        operation = "account.recovery_claim_read";
        const { data, error } = await admin.rpc("read_account_recovery_claim_command", {
          p_claim_id: publicRecoveryRoute[1],
          p_verification_token: input.data.verificationToken,
        });
        if (error) {
          status = "denied";
          return apiError(
            "claim_unavailable",
            "This recovery link is invalid or expired.",
            410,
            correlationId,
            origin,
          );
        }
        const parsed = accountRecoveryClaimSchema.safeParse(data);
        if (!parsed.success) throw new Error("invalid_internal_response");
        status = "succeeded";
        return json(parsed.data, 200, correlationId, origin);
      }
      operation = "account.recovery_complete";
      const unavailable = () =>
        apiError(
          "claim_unavailable",
          "This recovery request cannot be completed now.",
          409,
          correlationId,
          origin,
        );
      const finishing = () =>
        json(
          accountRecoveryCompletionSchema.parse({ state: "finishing" }),
          202,
          correlationId,
          origin,
        );
      const proof = {
        p_claim_id: publicRecoveryRoute[1],
        p_correlation_id: correlationId,
        p_verification_token: input.data.verificationToken,
      };
      // Preparation and dispatch each recheck delay, proof, notices and identity.
      const { error: prepareError } = await admin.rpc("prepare_account_recovery_command", proof);
      if (prepareError) {
        status = "denied";
        return unavailable();
      }
      const { data: dispatch, error: dispatchError } = await admin.rpc(
        "begin_account_recovery_dispatch_command",
        proof,
      );
      if (dispatchError) {
        const busy = dispatchError.message === "Recovery dispatch in progress";
        status = busy ? "degraded" : "denied";
        return busy ? finishing() : unavailable();
      }
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
      if (
        typeof dispatch?.dispatchId !== "string" ||
        !uuid.test(dispatch.dispatchId) ||
        typeof dispatch.accountId !== "string" ||
        !uuid.test(dispatch.accountId) ||
        typeof dispatch.newEmail !== "string"
      ) {
        throw new Error("invalid_internal_response");
      }
      // The provider response is deliberately not trusted: the email change is
      // fenced by the dispatch lease in the database and its outcome is read
      // back from Auth's own tables, so a lost or failed response cannot
      // mislead completion or trigger a blind resend.
      await admin.auth.admin
        .updateUserById(dispatch.accountId, { email: dispatch.newEmail, email_confirm: true })
        .catch(() => undefined);
      const { data: outcome, error: finishError } = await admin.rpc(
        "finish_account_recovery_dispatch_command",
        { p_correlation_id: correlationId, p_dispatch_id: dispatch.dispatchId },
      );
      if (finishError) throw finishError;
      if (outcome === "applied") {
        status = "succeeded";
        return json(
          accountRecoveryCompletionSchema.parse({ state: "completed" }),
          200,
          correlationId,
          origin,
        );
      }
      status = outcome === "dispatching" ? "degraded" : "denied";
      return outcome === "dispatching" ? finishing() : unavailable();
    }

    if (request.method === "GET" && route.startsWith("/public/")) {
      const notFound = () =>
        apiError("not_found", "This page does not exist.", 404, correlationId, origin);
      const gone = () =>
        apiError("gone", "This page is no longer available.", 410, correlationId, origin);
      const landing = route.match(/^\/public\/(events|unlisted)\/([0-9a-f]{32})$/u);
      if (landing) {
        operation = "public.event_landing";
        const { data, error } = await admin.rpc("public_event_landing_command", {
          p_key: landing[2],
          p_route: landing[1] === "events" ? "public" : "unlisted",
        });
        if (error) throw error;
        status = "succeeded";
        if (data?.status === "gone") return gone();
        if (data?.status !== "ok") return notFound();
        return publicJson(publicEventSummarySchema.parse(data.event), correlationId, origin, {
          unlisted: landing[1] === "unlisted",
        });
      }
      if (route === "/public/events") {
        operation = "public.event_discovery";
        const params = new URL(request.url).searchParams;
        const query = params.get("q") ?? "";
        const after = params.get("after");
        const [afterStartsAt, afterId] = after ? after.split("_") : [null, null];
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
        if (
          query.length > 100 ||
          (after &&
            (!afterId || !uuid.test(afterId) || Number.isNaN(Date.parse(afterStartsAt ?? ""))))
        ) {
          status = "denied";
          return apiError("invalid_request", "Check the search.", 400, correlationId, origin);
        }
        const { data, error } = await admin.rpc("public_list_events_command", {
          p_after_id: afterId,
          p_after_starts_at: afterStartsAt,
          p_limit: 20,
          p_live_only: params.get("live") === "1",
          p_query: query,
        });
        if (error) throw error;
        status = "succeeded";
        return publicJson(publicEventListSchema.parse(data), correlationId, origin);
      }
      const delivery = route.match(
        /^\/public\/(events|unlisted)\/([0-9a-f]{32})\/(manifest|safety)$/u,
      );
      if (delivery) {
        const manifest = delivery[3] === "manifest";
        operation = manifest ? "public.manifest" : "public.safety_feed";
        const { data, error } = await admin.rpc(
          manifest ? "public_event_manifest_command" : "public_event_safety_feed_command",
          { p_key: delivery[2], p_route: delivery[1] === "events" ? "public" : "unlisted" },
        );
        if (error) throw error;
        status = "succeeded";
        if (data?.status === "gone") return gone();
        if (data?.status !== "ok") return notFound();
        const body = manifest
          ? publicEventManifestSchema.parse(data.manifest)
          : publicSafetyFeedSchema.parse(data.feed);
        if (!manifest && JSON.stringify(body).length > 32_768)
          throw new Error("safety_feed_too_large");
        const response = publicJson(body, correlationId, origin, {
          unlisted: delivery[1] === "unlisted",
        });
        // Clients poll these; keep any shared cache short.
        response.headers.set(
          "cache-control",
          `${delivery[1] === "unlisted" ? "private" : "public"}, max-age=${manifest ? 15 : 5}`,
        );
        response.headers.set("x-robots-tag", noIndex);
        return response;
      }
      const snapshotRoute = route.match(
        /^\/public\/snapshots\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u,
      );
      if (snapshotRoute) {
        operation = "public.snapshot";
        const { data, error } = await admin.rpc("public_snapshot_command", {
          p_snapshot_id: snapshotRoute[1],
        });
        if (error) throw error;
        status = "succeeded";
        if (!data) return notFound();
        // Stored bytes are served as-is, after a strict allowlist check.
        publicSnapshotSchema.parse(JSON.parse(data.body));
        const etag = `"${data.sha256}"`;
        const secondsLeft = Math.max(
          0,
          Math.floor((Date.parse(data.expiresAt) - Date.now()) / 1000),
        );
        const headers = new Headers({
          ...corsHeaders(origin),
          "cache-control": `${data.unlisted ? "private" : "public"}, max-age=${Math.min(300, secondsLeft)}`,
          "content-type": "application/json; charset=utf-8",
          etag,
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-correlation-id": correlationId,
          "x-robots-tag": noIndex,
        });
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers });
        }
        return new Response(data.body, { status: 200, headers });
      }
      const routingPackage = route.match(
        /^\/public\/routing\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u,
      );
      if (routingPackage) {
        operation = "public.routing_package";
        const { data, error } = await admin.rpc("public_routing_package_command", {
          p_package_id: routingPackage[1],
        });
        if (error) throw error;
        status = "succeeded";
        if (!data) return notFound();
        const etag = `"${data.sha256}"`;
        // Immutable per version; the manifest decides which one is current
        // and its expiry, so a cached copy is never used on its own authority.
        const headers = new Headers({
          ...corsHeaders(origin),
          "cache-control": `${data.unlisted ? "private" : "public"}, max-age=31536000, immutable`,
          "content-type": "application/json; charset=utf-8",
          etag,
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-correlation-id": correlationId,
          "x-robots-tag": noIndex,
        });
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers });
        }
        return new Response(data.body, { status: 200, headers });
      }
      const organizerPage = route.match(/^\/public\/organizers\/([0-9a-f]{24})$/u);
      if (organizerPage) {
        operation = "public.organizer_page";
        const { data, error } = await admin.rpc("public_organizer_page_command", {
          p_key: organizerPage[1],
        });
        if (error) throw error;
        status = "succeeded";
        if (data?.status !== "ok") return notFound();
        return publicJson(publicOrganizerPageSchema.parse(data.organizer), correlationId, origin);
      }
      if (route === "/public/sitemap") {
        operation = "public.sitemap";
        const { data, error } = await admin.rpc("public_sitemap_command");
        if (error) throw error;
        status = "succeeded";
        return publicJson(publicSitemapSchema.parse(data), correlationId, origin);
      }
      status = "denied";
      return notFound();
    }

    if (request.method === "GET" && route === "/status") {
      // For outside-in monitors: overall state only, never topology or counts.
      operation = "operations.status";
      const { data, error } = await admin.rpc("operations_status_command");
      if (error) throw error;
      status = "succeeded";
      return json(operationsStatusSchema.parse(data), 200, correlationId, origin);
    }
    const feedbackRoute = route.match(/^\/public\/(events|unlisted)\/([0-9a-f]{32})\/feedback$/u);
    if (request.method === "POST" && (route === "/support" || feedbackRoute)) {
      const failures = new Map<string, [string, string, number]>([
        ["Invalid request", ["invalid_request", "Check the form.", 400]],
        ["Invalid feedback", ["invalid_request", "Check the form.", 400]],
        ["Request limit reached", ["rate_limited", "Too many requests. Try again later.", 429]],
        ["Support form paused", ["paused", "The form is paused. Try again later.", 503]],
        ["Feedback closed", ["feedback_closed", "Feedback is not open for this event.", 409]],
        ["Feedback already sent", ["already_sent", "Feedback was already sent from here.", 409]],
      ]);
      const failure = (message: string) => {
        const mapped = failures.get(message);
        if (!mapped) return null;
        status = "denied";
        return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
      };
      if (route === "/support") {
        operation = "support.submit";
        const input = supportRequestSchema.safeParse(await requestBody(request));
        if (!input.success) return failure("Invalid request") as Response;
        if (input.data.website) {
          status = "denied";
          return json({ received: true }, 202, correlationId, origin);
        }
        const { error } = await admin.rpc("submit_support_request_command", {
          p_body: input.data.message,
          p_contact: input.data.contact || null,
          p_network_bucket: await networkBucket(request),
          p_topic: input.data.topic,
        });
        if (error) {
          const denied = failure(error.message);
          if (denied) return denied;
          throw error;
        }
        status = "succeeded";
        return json({ received: true }, 202, correlationId, origin);
      }
      operation = "feedback.submit";
      const input = eventFeedbackRequestSchema.safeParse(await requestBody(request));
      if (!input.success) return failure("Invalid feedback") as Response;
      const { error } = await admin.rpc("submit_event_feedback_command", {
        p_comment: input.data.comment,
        p_event_key: (feedbackRoute as RegExpMatchArray)[2],
        p_followup_contact: input.data.followupContact || null,
        p_network_bucket: await networkBucket(request),
        p_rating: input.data.rating,
      });
      if (error) {
        const denied = failure(error.message);
        if (denied) return denied;
        throw error;
      }
      status = "succeeded";
      return json({ received: true }, 202, correlationId, origin);
    }

    const contactStart = route.match(/^\/public\/(events|unlisted)\/([0-9a-f]{32})\/contact$/u);
    const contactThread = route.match(
      /^\/contact\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/reply)?$/u,
    );
    if (request.method === "POST" && (contactStart || contactThread)) {
      const relayErrors = new Map<string, [string, string, number]>([
        ["Event not found", ["not_found", "This event does not take messages.", 404]],
        ["Thread not found", ["not_found", "This conversation is not available.", 404]],
        ["Relay closed", ["relay_closed", "This event no longer takes messages.", 409]],
        ["Invalid message", ["invalid_request", "Check the message.", 400]],
        ["Message limit reached", ["rate_limited", "Too many messages. Try again later.", 429]],
      ]);
      const relayFailure = (error: { message: string }) => {
        const mapped = relayErrors.get(error.message);
        if (!mapped) throw error;
        status = "denied";
        return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
      };
      if (contactStart) {
        operation = "relay.start";
        const input = contactOrganizerRequestSchema.safeParse(await requestBody(request));
        if (!input.success) {
          status = "denied";
          return apiError("invalid_request", "Check the message.", 400, correlationId, origin);
        }
        const token = [...crypto.getRandomValues(new Uint8Array(32))]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        // A filled honeypot gets a plausible answer and stores nothing.
        if (input.data.website) {
          status = "denied";
          return json({ threadId: crypto.randomUUID(), token }, 201, correlationId, origin);
        }
        const { data, error } = await admin.rpc("start_relay_thread_command", {
          p_body: input.data.message,
          p_event_key: contactStart[2],
          p_network_bucket: await networkBucket(request),
          p_token: token,
          p_visitor_email: input.data.visitorEmail,
        });
        if (error) return relayFailure(error);
        status = "succeeded";
        const started = contactStartedSchema.parse({ threadId: data.threadId, token });
        const response = json(started, 201, correlationId, origin);
        response.headers.set("referrer-policy", "no-referrer");
        return response;
      }
      const threadId = (contactThread as RegExpMatchArray)[1];
      if (!(contactThread as RegExpMatchArray)[2]) {
        operation = "relay.read";
        const input = relayTokenRequestSchema.safeParse(await requestBody(request));
        if (!input.success) return relayFailure({ message: "Thread not found" });
        const { data, error } = await admin.rpc("read_relay_thread_command", {
          p_thread_id: threadId,
          p_token: input.data.token,
        });
        if (error) throw error;
        if (!data) return relayFailure({ message: "Thread not found" });
        status = "succeeded";
        return json(relayThreadSchema.parse(data), 200, correlationId, origin);
      }
      operation = "relay.visitor_reply";
      const input = relayVisitorReplySchema.safeParse(await requestBody(request));
      if (!input.success) return relayFailure({ message: "Invalid message" });
      const { data, error } = await admin.rpc("reply_relay_thread_command", {
        p_actor_id: null,
        p_body: input.data.message,
        p_thread_id: threadId,
        p_token: input.data.token,
      });
      if (error) return relayFailure(error);
      status = "succeeded";
      return json(relayThreadSchema.parse(data), 200, correlationId, origin);
    }

    if ((route === "/reports" || route === "/reports/public") && request.method === "POST") {
      operation = "report.submit";
      const body = await requestBody(request);
      const input =
        route === "/reports"
          ? submitReportRequestSchema.safeParse(body)
          : submitPublicReportRequestSchema.safeParse(body);
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Check the report.", 400, correlationId, origin);
      }
      // A filled honeypot gets the same answer and stores nothing.
      if (input.data.website) {
        status = "denied";
        return json({ received: true }, 202, correlationId, origin);
      }
      let subject: { eventId: string; subjectId: string; subjectType: string } | null =
        "eventId" in input.data ? input.data : null;
      if ("eventKey" in input.data) {
        const { data: resolved, error: resolveError } = await admin.rpc(
          "resolve_public_report_subject_command",
          {
            p_event_key: input.data.eventKey,
            p_public_id: input.data.publicSubjectId,
            p_subject_type: input.data.subjectType,
          },
        );
        if (resolveError) throw resolveError;
        if (!resolved) {
          status = "denied";
          return apiError(
            "not_found",
            "That listing or location is gone.",
            404,
            correlationId,
            origin,
          );
        }
        subject = {
          eventId: resolved.eventId,
          subjectId: resolved.subjectId,
          subjectType: input.data.subjectType,
        };
      }
      if (!subject) throw new Error("invalid_internal_state");
      const { data, error } = await admin.rpc("submit_report_command", {
        p_confirms_no_consent: input.data.confirmsNoConsent,
        p_correlation_id: correlationId,
        p_details: input.data.details,
        p_event_id: subject.eventId,
        p_network_bucket: await networkBucket(request),
        p_reason: input.data.reason,
        p_relationship: input.data.relationship,
        p_reporter_contact: input.data.reporterContact || null,
        p_subject_id: subject.subjectId,
        p_subject_type: subject.subjectType,
      });
      if (error) {
        const mapped = new Map<string, [string, string, number]>([
          ["Report limit reached", ["rate_limited", "Too many reports. Try again later.", 429]],
          ["Report subject not found", ["not_found", "That listing or location is gone.", 404]],
          ["Invalid report", ["invalid_request", "Check the report.", 400]],
        ]).get(error.message);
        if (!mapped) throw error;
        status = "denied";
        return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
      }
      status = "succeeded";
      return json(data, 202, correlationId, origin);
    }

    const actor = await authenticatedActor(request);
    if (!actor) {
      operation = "api.authentication_denied";
      status = "denied";
      return apiError("unauthorized", "Authentication is required.", 401, correlationId, origin);
    }
    const actorId = actor.id;

    // With a verified TOTP factor, nothing but the MFA status is reachable
    // until this session completes the second step (aal2).
    const totpEnabled = actor.totpFactors.some((factor) => factor.verified);
    const mfaStatus = () =>
      mfaStatusSchema.parse({ assuranceLevel: actor.assuranceLevel, totpEnabled });
    if (totpEnabled && actor.assuranceLevel !== "aal2" && route !== "/account/mfa") {
      operation = "account.mfa_required";
      status = "denied";
      return apiError(
        "mfa_required",
        "Complete two-step verification first.",
        403,
        correlationId,
        origin,
      );
    }
    if (request.method === "GET" && route === "/account/mfa") {
      operation = "account.mfa_status_read";
      status = "succeeded";
      return json(mfaStatus(), 200, correlationId, origin);
    }
    if (request.method === "POST" && route.startsWith("/account/mfa/totp")) {
      const { error: recentError } = await admin.rpc("assert_recent_authentication_command", {
        p_authenticated_at: actor.authenticatedAt,
      });
      if (recentError) {
        status = "denied";
        return apiError(
          "recent_auth_required",
          "Sign in again before changing two-step verification.",
          403,
          correlationId,
          origin,
        );
      }
    }
    if (request.method === "POST" && route === "/account/mfa/totp") {
      operation = "account.mfa_totp_enroll";
      if (totpEnabled) {
        status = "denied";
        return apiError(
          "totp_already_enabled",
          "Two-step verification is already on.",
          409,
          correlationId,
          origin,
        );
      }
      // An abandoned setup is replaced rather than accumulating factors.
      for (const factor of actor.totpFactors) {
        await authAsUser(actor.token, `/factors/${factor.id}`, "DELETE");
      }
      const enrolled = await authAsUser(actor.token, "/factors", "POST", {
        factor_type: "totp",
        friendly_name: `Promenadis ${crypto.randomUUID().slice(0, 8)}`,
        issuer: "Promenadis",
      });
      if (!enrolled.ok) throw new Error("mfa_enrollment_failed");
      // Some Auth versions return raw SVG; an <img> data URI never runs scripts.
      const qr = enrolled.data?.totp?.qr_code;
      const parsed = totpEnrollmentSchema.safeParse({
        factorId: enrolled.data?.id,
        qrCode:
          typeof qr === "string" && !qr.startsWith("data:")
            ? `data:image/svg+xml;base64,${btoa(qr)}`
            : qr,
        secret: enrolled.data?.totp?.secret,
        uri: enrolled.data?.totp?.uri,
      });
      if (!parsed.success) throw new Error("invalid_internal_response");
      const { error: auditError } = await admin.rpc("record_account_mfa_event_command", {
        p_action: "account.mfa_totp_enrollment_started",
        p_actor_id: actorId,
        p_correlation_id: correlationId,
      });
      if (auditError) throw auditError;
      status = "succeeded";
      return json(parsed.data, 201, correlationId, origin);
    }
    if (request.method === "POST" && route === "/account/mfa/totp/remove") {
      operation = "account.mfa_totp_remove";
      const verified = actor.totpFactors.find((factor) => factor.verified);
      if (!verified) {
        status = "denied";
        return apiError(
          "totp_not_enabled",
          "Two-step verification is off.",
          409,
          correlationId,
          origin,
        );
      }
      const removed = await authAsUser(actor.token, `/factors/${verified.id}`, "DELETE");
      if (!removed.ok) throw new Error("mfa_removal_failed");
      const { error: auditError } = await admin.rpc("record_account_mfa_event_command", {
        p_action: "account.mfa_totp_removed",
        p_actor_id: actorId,
        p_correlation_id: correlationId,
      });
      if (auditError) throw auditError;
      status = "succeeded";
      return json(
        mfaStatusSchema.parse({ assuranceLevel: actor.assuranceLevel, totpEnabled: false }),
        200,
        correlationId,
        origin,
      );
    }

    // A pending deletion disables the account: only its status and cancellation remain.
    const deletionRoute = route === "/account/deletion" || route === "/account/deletion/cancel";
    const { data: deletionPending, error: deletionError } = await admin.rpc(
      "account_deletion_pending",
      { p_account_id: actorId },
    );
    if (deletionError) throw deletionError;
    if (deletionPending === true && !deletionRoute) {
      operation = "account.disabled_access_denied";
      status = "denied";
      return apiError(
        "account_deletion_pending",
        "This account is scheduled for deletion.",
        403,
        correlationId,
        origin,
      );
    }

    if (request.method === "GET" && route === "/account/deletion") {
      operation = "account.deletion_status_read";
      const { data, error } = await admin.rpc("get_account_deletion_command", {
        p_actor_id: actorId,
      });
      if (error) throw error;
      const parsed = accountDeletionStatusSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    if (request.method === "POST" && route === "/account/deletion") {
      operation = "account.deletion_request";
      const input = requestAccountDeletionRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Confirm with your email.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("request_account_deletion_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_confirmation_email: input.data.confirmationEmail,
        p_correlation_id: correlationId,
      });
      if (error) {
        const mapped = new Map<string, [string, string, number]>([
          [
            "Recent authentication required",
            ["recent_auth_required", "Sign in again before deleting the account.", 403],
          ],
          [
            "Deletion confirmation mismatch",
            ["confirmation_mismatch", "The confirmation does not match.", 400],
          ],
          ["Account deletion blocked", ["deletion_blocked", "Resolve the listed items.", 409]],
          [
            "Account deletion already requested",
            ["deletion_pending", "Deletion is already scheduled.", 409],
          ],
        ]).get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = accountDeletionStatusSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    if (request.method === "POST" && route === "/account/deletion/cancel") {
      operation = "account.deletion_cancel";
      const { data, error } = await admin.rpc("cancel_account_deletion_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
      });
      if (error) {
        if (error.message !== "Account deletion not pending") throw error;
        status = "denied";
        return apiError("not_pending", "No deletion is scheduled.", 409, correlationId, origin);
      }
      const parsed = accountDeletionStatusSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    if (request.method === "GET" && route === "/dashboard") {
      operation = "identity.dashboard_read";
      const { data, error } = await admin.rpc("get_identity_dashboard_command", {
        p_actor_id: actorId,
      });
      if (error) throw error;
      const parsed = identityDashboardSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    if (request.method === "PUT" && route === "/profile") {
      operation = "profile.update";
      const input = updateProfileRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Check the profile fields.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("update_profile_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_display_name: input.data.displayName,
        p_preferred_locale: input.data.preferredLocale,
      });
      if (error) throw error;
      const parsed = accountProfileSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const cancelRecovery = route.match(/^\/account\/recovery-claims\/([0-9a-f-]{36})\/cancel$/iu);
    if (request.method === "POST" && cancelRecovery) {
      operation = "account.recovery_claim_cancel";
      const { data, error } = await admin.rpc("cancel_account_recovery_claim_command", {
        p_actor_id: actorId,
        p_claim_id: cancelRecovery[1],
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
      });
      if (error) {
        status = "denied";
        const recent = error.message === "Recent authentication required";
        return apiError(
          recent ? "recent_auth_required" : "claim_unavailable",
          recent ? "Sign in again before cancelling recovery." : "Recovery claim unavailable.",
          recent ? 403 : 409,
          correlationId,
          origin,
        );
      }
      const parsed = accountRecoveryStatusSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    if (request.method === "GET" && route === "/account/recovery-code") {
      operation = "account.recovery_code_status_read";
      const { data, error } = await admin.rpc("get_account_security_command", {
        p_actor_id: actorId,
      });
      if (error) throw error;
      const parsed = accountRecoveryStatusSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    if (request.method === "POST" && route === "/account/recovery-code") {
      operation = "account.recovery_code_enroll";
      const input = enrollRecoveryCodeRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Reload the recovery-code status.",
          400,
          correlationId,
          origin,
        );
      }
      const recoveryCode = generateRecoveryCode();
      const { data, error } = await admin.rpc("enroll_account_recovery_code_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_code: recoveryCode,
        p_correlation_id: correlationId,
        p_expected_version: input.data.expectedVersion,
      });
      if (error) {
        const knownError = new Map<string, [string, string, number]>([
          [
            "Recent authentication required",
            ["recent_auth_required", "Sign in again before creating a recovery code.", 403],
          ],
          [
            "Verified email required",
            ["verified_email_required", "A verified email address is required.", 403],
          ],
          [
            "Recovery code version conflict",
            ["version_conflict", "The recovery code changed. Reload and try again.", 409],
          ],
        ]);
        const mapped = knownError.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = recoveryCodeEnrollmentResponseSchema.safeParse({
        ...data,
        code: recoveryCode,
      });
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 201, correlationId, origin);
    }

    if (request.method === "POST" && route === "/organizers") {
      operation = "organizer.create";
      const input = createOrganizerProfileRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Check the organizer fields.",
          400,
          correlationId,
          origin,
        );
      }
      const { data, error } = await admin.rpc("create_organizer_profile_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_display_name: input.data.displayName,
        p_locality: input.data.locality,
        p_organizer_type: input.data.organizerType,
        p_website: input.data.website,
      });
      if (error) throw error;
      const parsed = commandResourceResponseSchema.safeParse({ id: data, schemaVersion: "1.0" });
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 201, correlationId, origin);
    }

    const organizerRoute = route.match(
      /^\/organizers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu,
    );
    if (request.method === "PUT" && organizerRoute) {
      operation = "organizer.profile_update";
      const input = updateOrganizerProfileRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Check the organizer fields.",
          400,
          correlationId,
          origin,
        );
      }
      const { data, error } = await admin.rpc("update_organizer_profile_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_display_name: input.data.displayName,
        p_expected_version: input.data.expectedVersion,
        p_locality: input.data.locality,
        p_organizer_profile_id: organizerRoute[1],
        p_website: input.data.website,
      });
      if (error) {
        const mapped = new Map<string, [string, string, number]>([
          ["Organizer profile not found", ["not_found", "Organizer not found.", 404]],
          [
            "Organizer version conflict",
            ["version_conflict", "The organizer changed. Reload.", 409],
          ],
          ["Invalid organizer profile", ["invalid_request", "Check the organizer fields.", 400]],
        ]).get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = organizerProfileDetailsSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    if (request.method === "GET" && route === "/organizer-invites") {
      operation = "organizer.incoming_invites_read";
      const { data, error } = await admin.rpc("get_incoming_organizer_invites_command", {
        p_actor_id: actorId,
      });
      if (error) throw error;
      const parsed = incomingOrganizerInvitesSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const acceptOrganizerInviteRoute = route.match(
      /^\/organizer-invites\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/accept$/iu,
    );
    if (request.method === "POST" && acceptOrganizerInviteRoute) {
      operation = "organizer.manager_invite_accept";
      const input = acceptEventTeamInviteRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Enter a display name.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("accept_organizer_manager_invite_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_display_name: input.data.displayName,
        p_invite_id: acceptOrganizerInviteRoute[1],
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = organizerTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const organizerTeamRoute = route.match(
      /^\/organizers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team$/iu,
    );
    if (request.method === "GET" && organizerTeamRoute) {
      operation = "organizer.team_read";
      const { data, error } = await admin.rpc("get_organizer_team_command", {
        p_actor_id: actorId,
        p_organizer_profile_id: organizerTeamRoute[1],
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = organizerTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const organizerInvitesRoute = route.match(
      /^\/organizers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/invites$/iu,
    );
    if (request.method === "POST" && organizerInvitesRoute) {
      operation = "organizer.manager_invite_create";
      const input = inviteOrganizerManagerRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Check the invitation email.",
          400,
          correlationId,
          origin,
        );
      }
      const { data, error } = await admin.rpc("invite_organizer_manager_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
        p_email: input.data.email,
        p_expected_team_version: input.data.expectedTeamVersion,
        p_organizer_profile_id: organizerInvitesRoute[1],
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = organizerTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 201, correlationId, origin);
    }

    const organizerInviteRoute = route.match(
      /^\/organizers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/invites\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu,
    );
    if (request.method === "DELETE" && organizerInviteRoute) {
      operation = "organizer.manager_invite_cancel";
      const input = eventTeamVersionRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Reload the organizer team.",
          400,
          correlationId,
          origin,
        );
      }
      const { data, error } = await admin.rpc("cancel_organizer_manager_invite_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
        p_expected_team_version: input.data.expectedTeamVersion,
        p_invite_id: organizerInviteRoute[2],
        p_organizer_profile_id: organizerInviteRoute[1],
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = organizerTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const organizerMemberRoute = route.match(
      /^\/organizers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/members\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu,
    );
    if (request.method === "DELETE" && organizerMemberRoute) {
      operation = "organizer.manager_remove";
      const input = eventTeamVersionRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Reload the organizer team.",
          400,
          correlationId,
          origin,
        );
      }
      const { data, error } = await admin.rpc("remove_organizer_manager_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
        p_expected_team_version: input.data.expectedTeamVersion,
        p_membership_id: organizerMemberRoute[2],
        p_organizer_profile_id: organizerMemberRoute[1],
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = organizerTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    if (request.method === "POST" && route === "/events") {
      operation = "event.draft_create";
      const input = createDraftEventRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Check the event fields.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("create_scheduled_draft_event_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_description: input.data.description,
        p_ends_at: input.data.endsAt,
        p_organizer_profile_id: input.data.organizerProfileId,
        p_public_organizer_name: input.data.publicOrganizerName,
        p_starts_at: input.data.startsAt,
        p_timezone: input.data.timezone,
        p_title: input.data.title,
        p_visibility: input.data.visibility,
      });
      if (
        error?.message === "Actor is not an organizer manager" ||
        error?.message === "Organizer selection is required"
      ) {
        status = "denied";
        return apiError(
          "forbidden",
          error.message === "Organizer selection is required"
            ? "Select which organizer is creating this event."
            : "You cannot create an event for this organizer.",
          403,
          correlationId,
          origin,
        );
      }
      if (error) throw error;
      const parsed = commandResourceResponseSchema.safeParse({ id: data, schemaVersion: "1.0" });
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 201, correlationId, origin);
    }

    if (request.method === "GET" && route === "/team-invites") {
      operation = "event.team_incoming_invites_read";
      const { data, error } = await admin.rpc("get_incoming_event_invites_command", {
        p_actor_id: actorId,
      });
      if (error) throw error;
      const parsed = incomingEventTeamInvitesSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const acceptInviteRoute = route.match(
      /^\/team-invites\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/accept$/iu,
    );
    if (request.method === "POST" && acceptInviteRoute) {
      operation = "event.team_invite_accept";
      const input = acceptEventTeamInviteRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Enter a display name for this event team.",
          400,
          correlationId,
          origin,
        );
      }
      const { data, error } = await admin.rpc("accept_event_team_invite_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_display_name: input.data.displayName,
        p_invite_id: acceptInviteRoute[1],
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const teamRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team$/iu,
    );
    if (request.method === "GET" && teamRoute) {
      operation = "event.team_read";
      const { data, error } = await admin.rpc("get_event_team_command", {
        p_actor_id: actorId,
        p_event_id: teamRoute[1],
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const emergencySuccessorRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/emergency-successor$/iu,
    );
    if (emergencySuccessorRoute && (request.method === "PUT" || request.method === "DELETE")) {
      operation =
        request.method === "PUT"
          ? "event.emergency_successor_set"
          : "event.emergency_successor_clear";
      const rawBody = await requestBody(request);
      const input =
        request.method === "PUT"
          ? setEmergencySuccessorRequestSchema.safeParse(rawBody)
          : eventTeamVersionRequestSchema.safeParse(rawBody);
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Reload the event team.", 400, correlationId, origin);
      }
      const parameters: Record<string, unknown> = {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
        p_event_id: emergencySuccessorRoute[1],
        p_expected_team_version: input.data.expectedTeamVersion,
      };
      if (request.method === "PUT" && "successorMembershipId" in input.data) {
        parameters.p_successor_membership_id = input.data.successorMembershipId;
        parameters.p_target_organizer_profile_id = input.data.targetOrganizerProfileId;
      }
      const { data, error } = await admin.rpc(
        request.method === "PUT"
          ? "set_event_emergency_successor_command"
          : "clear_event_emergency_successor_command",
        parameters,
      );
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const createEmergencyClaimRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/emergency-successor-claims$/iu,
    );
    if (request.method === "POST" && createEmergencyClaimRoute) {
      operation = "event.emergency_successor_claim_initiate";
      const input = eventTeamVersionRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Reload the event team.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("initiate_event_emergency_successor_claim_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
        p_event_id: createEmergencyClaimRoute[1],
        p_expected_team_version: input.data.expectedTeamVersion,
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 201, correlationId, origin);
    }

    const emergencyClaimRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/emergency-successor-claims\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/complete)?$/iu,
    );
    if (
      emergencyClaimRoute &&
      ((request.method === "DELETE" && !emergencyClaimRoute[3]) ||
        (request.method === "POST" && emergencyClaimRoute[3] === "/complete"))
    ) {
      const completing = request.method === "POST";
      operation = completing
        ? "event.emergency_successor_claim_complete"
        : "event.emergency_successor_claim_cancel";
      const input = eventTeamVersionRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Reload the event team.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc(
        completing
          ? "complete_event_emergency_successor_claim_command"
          : "cancel_event_emergency_successor_claim_command",
        {
          p_actor_id: actorId,
          p_authenticated_at: actor.authenticatedAt,
          p_claim_id: emergencyClaimRoute[2],
          p_correlation_id: correlationId,
          p_event_id: emergencyClaimRoute[1],
          p_expected_team_version: input.data.expectedTeamVersion,
        },
      );
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const verificationRoute = route.match(
      /^\/organizers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/verification$/iu,
    );
    if (verificationRoute && (request.method === "GET" || request.method === "POST")) {
      const organizerProfileId = verificationRoute[1];
      let rpc: { data: unknown; error: { message: string } | null };
      if (request.method === "GET") {
        operation = "organizer.verification_read";
        rpc = await admin.rpc("get_organizer_verification_command", {
          p_actor_id: actorId,
          p_organizer_profile_id: organizerProfileId,
        });
      } else {
        operation = "organizer.verification_request";
        const input = requestOrganizerVerificationSchema.safeParse(await requestBody(request));
        const organizationNumber = input.success
          ? normalizeOrganizationNumber(input.data.organizationNumber)
          : null;
        if (!input.success || !organizationNumber) {
          status = "denied";
          return apiError(
            "invalid_organization_number",
            "Check the organization number.",
            400,
            correlationId,
            origin,
          );
        }
        rpc = await admin.rpc("request_organizer_verification_command", {
          p_actor_id: actorId,
          p_control_method: input.data.controlMethod,
          p_control_reference: input.data.controlReference,
          p_correlation_id: correlationId,
          p_organization_number: organizationNumber,
          p_organizer_profile_id: organizerProfileId,
        });
      }
      if (rpc.error) {
        const mapped = new Map<string, [string, string, number]>([
          ["Organizer profile not found", ["not_found", "Organizer not found.", 404]],
          [
            "Only associations and companies can be verified",
            ["not_eligible", "Only associations and companies can be verified.", 409],
          ],
          [
            "Invalid organization number",
            ["invalid_organization_number", "Check the number.", 400],
          ],
          ["Verification already requested", ["already_requested", "Already requested.", 409]],
        ]).get(rpc.error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw rpc.error;
      }
      const parsed = organizerVerificationStatusSchema.safeParse(rpc.data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const earlyVisibilityRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/early-location-visibility$/iu,
    );
    if (request.method === "PUT" && earlyVisibilityRoute) {
      operation = "event.early_visibility_set";
      const input = setEarlyLocationVisibilityRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Check the request.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("set_early_location_visibility_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_event_id: earlyVisibilityRoute[1],
        p_expected_event_version: input.data.expectedEventVersion,
        p_visible: input.data.visible,
      });
      if (error) {
        const mapped = new Map<string, [string, string, number]>([
          ["Actor cannot manage admission", ["forbidden", "Only hosts can change this.", 403]],
          ["Event version conflict", ["version_conflict", "The event changed. Reload.", 409]],
          ["Early visibility is locked", ["invalid_state", "This can no longer change.", 409]],
        ]).get(error.message);
        if (!mapped) throw error;
        status = "denied";
        return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
      }
      status = "succeeded";
      return json(earlyLocationVisibilitySchema.parse(data), 200, correlationId, origin);
    }

    const routingRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/routing(?:\/builds(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(confirm|package))?|\/overrides(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?)?$/iu,
    );
    if (routingRoute) {
      const [, eventId, buildId, buildAction, overrideId] = routingRoute;
      const isBuilds = route.includes("/routing/builds");
      const isOverrides = route.includes("/routing/overrides");
      const routingErrors = new Map<string, [string, string, number]>([
        [
          "Actor is not an event team member",
          ["forbidden", "You are not on this event team.", 403],
        ],
        [
          "Actor cannot manage walking routes",
          ["forbidden", "Only hosts can change walking routes.", 403],
        ],
        [
          "Walking routes are closed",
          ["invalid_state", "Walking routes can no longer change.", 409],
        ],
        ["Boundary required", ["boundary_required", "Draw the event area first.", 409]],
        ["Build already running", ["build_running", "A build is already running.", 409]],
        ["Build not ready for review", ["invalid_state", "This build cannot be confirmed.", 409]],
        [
          "Build is out of date",
          ["build_outdated", "The area or overrides changed. Build again.", 409],
        ],
        [
          "Disconnected locations need a decision",
          ["disconnected_locations", "Decide on every disconnected stop first.", 409],
        ],
        [
          "Resolve the build warnings first",
          ["build_warnings", "Resolve the build warnings first.", 409],
        ],
        ["Reason required", ["invalid_request", "Give a reason.", 400]],
        ["Recent authentication required", ["recent_auth_required", "Sign in again first.", 403]],
        ["Invalid override", ["invalid_request", "Check the override.", 400]],
        ["Location not found", ["not_found", "That stop is gone.", 404]],
        ["Override not found", ["not_found", "That override is gone.", 404]],
        [
          "Entrance must be within 25 metres of the pin",
          ["invalid_request", "An entrance must be within 25 metres of the pin.", 400],
        ],
        [
          "Safe walking attestation required",
          ["invalid_request", "Confirm the path is legal and safe to walk.", 400],
        ],
        [
          "Connector longer than 100 metres",
          ["invalid_request", "A connector is at most 100 metres.", 400],
        ],
        [
          "Connector outside the event area",
          ["invalid_request", "Keep the connector inside the area.", 400],
        ],
        [
          "Only safety blocks during the event",
          ["invalid_state", "During the event only blocks and manual-access marks apply.", 409],
        ],
      ]);
      const routingFailure = (error: { message: string }) => {
        const mapped = routingErrors.get(error.message);
        if (!mapped) throw error;
        status = "denied";
        return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
      };
      const routingState = async () => {
        const { data, error } = await admin.rpc("get_event_routing_command", {
          p_actor_id: actorId,
          p_event_id: eventId,
        });
        if (error) return routingFailure(error);
        status = "succeeded";
        return json(eventRoutingSchema.parse(data), 200, correlationId, origin);
      };
      if (!isBuilds && !isOverrides && request.method === "GET") {
        operation = "routing.read";
        return routingState();
      }
      if (isBuilds && !buildId && request.method === "POST") {
        operation = "routing.build";
        const { metadata, source } = await loadRoutingSource();
        const { data: started, error } = await admin.rpc("start_routing_build_command", {
          p_actor_id: actorId,
          p_compiler_version: COMPILER_VERSION,
          p_correlation_id: correlationId,
          p_event_id: eventId,
          p_source_metadata: metadata,
          p_source_sha256: metadata.sha256,
        });
        if (error) return routingFailure(error);
        if (!started.reused) {
          // Local compiler: runs here against the verified fixture. Hosted
          // builds run in a pinned container with the same compiler.
          try {
            const result = buildRoutingPackage({
              boundary: started.boundary,
              locations: started.locations.map(
                (location: { id: string; longitude: number; latitude: number }) => ({
                  id: location.id,
                  point: [location.longitude, location.latitude] as const,
                }),
              ),
              overrides: started.overrides.flatMap(
                (override: {
                  id: string;
                  kind: string;
                  edgeKey: string | null;
                  locationId: string | null;
                  point: [number, number] | null;
                  toPoint: [number, number] | null;
                }) =>
                  override.kind === "block_edge" && override.edgeKey
                    ? [{ edgeKey: override.edgeKey, id: override.id, kind: "block_edge" as const }]
                    : override.kind === "manual_access" && override.locationId
                      ? [
                          {
                            id: override.id,
                            kind: "manual_access" as const,
                            locationId: override.locationId,
                          },
                        ]
                      : override.kind === "entrance" && override.locationId && override.point
                        ? [
                            {
                              id: override.id,
                              kind: "entrance" as const,
                              locationId: override.locationId,
                              point: override.point,
                            },
                          ]
                        : override.kind === "connector" && override.point && override.toPoint
                          ? [
                              {
                                from: override.point,
                                id: override.id,
                                kind: "connector" as const,
                                to: override.toPoint,
                              },
                            ]
                          : [],
              ),
              source,
              sourceMetadata: metadata,
            });
            if (!validateRoutingPackage(JSON.parse(result.body)))
              throw new Error("invalid_package");
            const { error: completeError } = await admin.rpc("complete_routing_build_command", {
              p_body: result.body,
              p_build_id: started.buildId,
              p_diagnostics: result.diagnostics,
            });
            if (completeError) throw completeError;
          } catch (buildError) {
            await admin.rpc("fail_routing_build_command", {
              p_build_id: started.buildId,
              p_error: buildError instanceof Error ? buildError.message : "build_failed",
            });
          }
        }
        return routingState();
      }
      if (isBuilds && buildId && buildAction === "confirm" && request.method === "POST") {
        operation = "routing.confirm";
        const { error } = await admin.rpc("confirm_routing_build_command", {
          p_actor_id: actorId,
          p_build_id: buildId,
          p_correlation_id: correlationId,
          p_event_id: eventId,
        });
        if (error) return routingFailure(error);
        return routingState();
      }
      if (isBuilds && buildId && buildAction === "package" && request.method === "GET") {
        operation = "routing.preview_package";
        const { data, error } = await admin.rpc("team_routing_package_command", {
          p_actor_id: actorId,
          p_build_id: buildId,
          p_event_id: eventId,
        });
        if (error) return routingFailure(error);
        if (!data) {
          status = "denied";
          return apiError("not_found", "That build has no package.", 404, correlationId, origin);
        }
        status = "succeeded";
        const response = new Response(data, {
          status: 200,
          headers: {
            ...corsHeaders(origin),
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
            "x-correlation-id": correlationId,
            "x-content-type-options": "nosniff",
          },
        });
        return response;
      }
      if (isOverrides && !overrideId && request.method === "POST") {
        operation = "routing.override_add";
        const input = addRoutingOverrideRequestSchema.safeParse(await requestBody(request));
        if (!input.success) {
          status = "denied";
          return apiError("invalid_request", "Check the override.", 400, correlationId, origin);
        }
        const override = input.data;
        const { error } = await admin.rpc("add_routing_override_command", {
          p_actor_id: actorId,
          p_authenticated_at: actor.authenticatedAt,
          p_correlation_id: correlationId,
          p_edge_key: override.kind === "block_edge" ? override.edgeKey : null,
          p_event_id: eventId,
          p_kind: override.kind,
          p_location_id:
            override.kind === "manual_access" || override.kind === "entrance"
              ? override.locationId
              : null,
          p_point:
            override.kind === "entrance"
              ? override.point
              : override.kind === "connector"
                ? override.from
                : null,
          p_reason: override.reason,
          p_safe_walking_attested:
            override.kind === "connector" ? override.safeWalkingAttested : false,
          p_to_point: override.kind === "connector" ? override.to : null,
        });
        if (error) return routingFailure(error);
        return routingState();
      }
      if (isOverrides && overrideId && request.method === "DELETE") {
        operation = "routing.override_remove";
        const { error } = await admin.rpc("remove_routing_override_command", {
          p_actor_id: actorId,
          p_correlation_id: correlationId,
          p_override_id: overrideId,
        });
        if (error) return routingFailure(error);
        return routingState();
      }
    }

    const publicLinkRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(public-link|unlisted-link\/rotate)$/iu,
    );
    if (publicLinkRoute && (request.method === "GET" || request.method === "POST")) {
      const [, eventId, action] = publicLinkRoute;
      const rotating = action !== "public-link";
      if (rotating !== (request.method === "POST")) {
        status = "denied";
        return apiError("not_found", "Route not found.", 404, correlationId, origin);
      }
      operation = rotating ? "event.unlisted_link_rotate" : "event.public_link_read";
      const input = rotating
        ? rotateUnlistedLinkRequestSchema.safeParse(await requestBody(request))
        : null;
      if (input && !input.success) {
        status = "denied";
        return apiError("invalid_request", "Check the request.", 400, correlationId, origin);
      }
      const { data, error } = input?.success
        ? await admin.rpc("rotate_unlisted_link_command", {
            p_actor_id: actorId,
            p_authenticated_at: actor.authenticatedAt,
            p_correlation_id: correlationId,
            p_event_id: eventId,
            p_expected_event_version: input.data.expectedEventVersion,
            p_safety_reason: input.data.safetyReason ?? null,
          })
        : await admin.rpc("get_event_public_link_command", {
            p_actor_id: actorId,
            p_event_id: eventId,
          });
      if (error) {
        const mapped = new Map<string, [string, string, number]>([
          [
            "Actor is not an event team member",
            ["forbidden", "You are not on this event team.", 403],
          ],
          [
            "Only the event owner can rotate the link",
            ["forbidden", "Only the owner can change the link.", 403],
          ],
          ["Recent authentication required", ["recent_auth_required", "Sign in again first.", 403]],
          ["Event version conflict", ["version_conflict", "The event changed. Reload.", 409]],
          [
            "Only unlisted links can be rotated",
            ["invalid_state", "Only unlisted links can be changed.", 409],
          ],
          [
            "This link can no longer be rotated",
            ["invalid_state", "This link can no longer be changed.", 409],
          ],
          ["Safety reason required", ["invalid_request", "Give the safety reason.", 400]],
        ]).get(error.message);
        if (!mapped) throw error;
        status = "denied";
        return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
      }
      status = "succeeded";
      return json(eventPublicLinkSchema.parse(data), 200, correlationId, origin);
    }

    const lifecycleRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(publish|cancel|end-early)$/iu,
    );
    if (request.method === "POST" && lifecycleRoute) {
      const [, eventId, action] = lifecycleRoute;
      operation = `event.${action.replace("-", "_")}`;
      const body = await requestBody(request);
      const simple = publishEventRequestSchema.safeParse(body);
      const cancel = action === "cancel" ? cancelEventRequestSchema.safeParse(body) : null;
      if (action === "cancel" ? !cancel?.success : !simple.success) {
        status = "denied";
        return apiError("invalid_request", "Check the confirmation.", 400, correlationId, origin);
      }
      const { data, error } =
        action === "publish"
          ? await admin.rpc("publish_event_command", {
              p_actor_id: actorId,
              p_authenticated_at: actor.authenticatedAt,
              p_correlation_id: correlationId,
              p_event_id: eventId,
              p_expected_event_version: simple.data?.expectedEventVersion,
            })
          : action === "cancel"
            ? await admin.rpc("cancel_event_command", {
                p_actor_id: actorId,
                p_authenticated_at: actor.authenticatedAt,
                p_confirmation_title: cancel?.data?.confirmTitle,
                p_correlation_id: correlationId,
                p_event_id: eventId,
                p_expected_event_version: cancel?.data?.expectedEventVersion,
                p_public_reason: cancel?.data?.publicReason,
              })
            : await admin.rpc("end_event_early_command", {
                p_actor_id: actorId,
                p_correlation_id: correlationId,
                p_event_id: eventId,
                p_expected_event_version: simple.data?.expectedEventVersion,
              });
      if (error) {
        const mapped = new Map<string, [string, string, number]>([
          ["Only the event owner can publish", ["forbidden", "Only the owner can publish.", 403]],
          ["Only the event owner can cancel", ["forbidden", "Only the owner can cancel.", 403]],
          [
            "Only the owner or a co-host can end the event",
            ["forbidden", "Only the owner or a co-host can end the event.", 403],
          ],
          ["Recent authentication required", ["recent_auth_required", "Sign in again first.", 403]],
          ["Event version conflict", ["version_conflict", "The event changed. Reload.", 409]],
          ["Event not ready to publish", ["not_ready", "The event is not ready to publish.", 409]],
          ["Event already started", ["invalid_state", "The event has already started.", 409]],
          [
            "Only draft events can be published",
            ["invalid_state", "Only drafts can be published.", 409],
          ],
          [
            "Only published events can be cancelled",
            ["invalid_state", "Only published events can be cancelled.", 409],
          ],
          [
            "Only active events can end early",
            ["invalid_state", "Only live events can end early.", 409],
          ],
          [
            "Cancellation confirmation mismatch",
            ["confirmation_mismatch", "Type the exact event title.", 400],
          ],
          ["Cancellation reason required", ["invalid_request", "Give a public reason.", 400]],
        ]).get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventLifecycleResultSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const firstReviewRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/first-review$/iu,
    );
    if (firstReviewRoute && request.method === "GET") {
      operation = "event.first_review_read";
      const { data, error } = await admin.rpc("get_first_event_review_command", {
        p_actor_id: actorId,
        p_event_id: firstReviewRoute[1],
      });
      if (error) {
        status = "denied";
        return apiError("not_found", "Event not found.", 404, correlationId, origin);
      }
      const parsed = firstEventReviewStatusSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }
    if (firstReviewRoute && request.method === "POST") {
      operation = "event.first_review_request";
      const input = requestFirstEventReviewSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Reload the event.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("request_first_event_review_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_event_id: firstReviewRoute[1],
        p_expected_event_version: input.data.expectedEventVersion,
      });
      if (error) {
        const mapped = new Map<string, [string, string, number]>([
          [
            "Only the event owner can request review",
            ["forbidden", "Only the owner can request review.", 403],
          ],
          [
            "Event version conflict",
            ["version_conflict", "The event changed. Reload and try again.", 409],
          ],
          ["First-event review not needed", ["review_not_needed", "No review is needed now.", 409]],
          ["Event not ready for review", ["not_ready", "Finish the setup steps first.", 409]],
        ]).get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventPublicationReadinessSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    // Admin mode: operator-granted eligibility + aal2 + a fresh TOTP code,
    // bound to this Auth session for 15 minutes. Never ambient.
    if (route === "/admin" || route.startsWith("/admin/")) {
      const adminStatus = async () => {
        const { data, error } = await admin.rpc("get_admin_status_command", {
          p_actor_id: actorId,
          p_auth_session_id: actor.sessionId,
        });
        if (error) throw error;
        return adminStatusSchema.parse(data);
      };
      const denied = (code: string, message: string, httpStatus: number) => {
        status = "denied";
        return apiError(code, message, httpStatus, correlationId, origin);
      };
      if (request.method === "GET" && route === "/admin/status") {
        operation = "admin.status_read";
        status = "succeeded";
        return json(await adminStatus(), 200, correlationId, origin);
      }
      if (request.method === "POST" && route === "/admin/elevation") {
        operation = "admin.elevation_start";
        const input = adminElevationRequestSchema.safeParse(await requestBody(request));
        if (!input.success) return denied("invalid_request", "Enter the six-digit code.", 400);
        const { data: eligible, error: eligibleError } = await admin.rpc("is_platform_admin", {
          p_account_id: actorId,
        });
        if (eligibleError) throw eligibleError;
        if (eligible !== true) return denied("forbidden", "Not a platform administrator.", 403);
        const factor = actor.totpFactors.find((candidate) => candidate.verified);
        if (!factor || actor.assuranceLevel !== "aal2") {
          return denied("mfa_required", "Two-step verification is required for admin mode.", 403);
        }
        const challenge = await authAsUser(
          actor.token,
          `/factors/${factor.id}/challenge`,
          "POST",
          {},
        );
        const verified =
          challenge.ok && typeof challenge.data?.id === "string"
            ? await authAsUser(actor.token, `/factors/${factor.id}/verify`, "POST", {
                challenge_id: challenge.data.id,
                code: input.data.code,
              })
            : null;
        if (!verified?.ok) return denied("mfa_failed", "The code did not match.", 400);
        const { error } = await admin.rpc("start_admin_elevation_command", {
          p_actor_id: actorId,
          p_auth_session_id: actor.sessionId,
          p_correlation_id: correlationId,
        });
        if (error) throw error;
        status = "succeeded";
        return json(await adminStatus(), 200, correlationId, origin);
      }
      if (request.method === "POST" && route === "/admin/elevation/end") {
        operation = "admin.elevation_end";
        const { error } = await admin.rpc("end_admin_elevation_command", {
          p_actor_id: actorId,
          p_correlation_id: correlationId,
        });
        if (error) throw error;
        status = "succeeded";
        return json(await adminStatus(), 200, correlationId, origin);
      }
      if (request.method === "GET" && route === "/admin/reviews") {
        operation = "admin.first_review_queue_read";
        const { data, error } = await admin.rpc("list_first_event_reviews_command", {
          p_actor_id: actorId,
          p_auth_session_id: actor.sessionId,
          p_correlation_id: correlationId,
        });
        if (error) {
          if (error.message === "Admin elevation required") {
            return denied("elevation_required", "Enter admin mode first.", 403);
          }
          throw error;
        }
        const parsed = firstEventReviewQueueSchema.safeParse(data);
        if (!parsed.success) throw new Error("invalid_internal_response");
        status = "succeeded";
        return json(parsed.data, 200, correlationId, origin);
      }
      if (request.method === "GET" && route === "/admin/organizer-verifications") {
        operation = "admin.organizer_verification_queue_read";
        const { data, error } = await admin.rpc("list_organizer_verifications_command", {
          p_actor_id: actorId,
          p_auth_session_id: actor.sessionId,
          p_correlation_id: correlationId,
        });
        if (error) {
          if (error.message === "Admin elevation required") {
            return denied("elevation_required", "Enter admin mode first.", 403);
          }
          throw error;
        }
        const parsed = organizerVerificationQueueSchema.safeParse(data);
        if (!parsed.success) throw new Error("invalid_internal_response");
        status = "succeeded";
        return json(parsed.data, 200, correlationId, origin);
      }
      const verificationDecision = route.match(
        /^\/admin\/organizer-verifications\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/decision$/iu,
      );
      if (request.method === "POST" && verificationDecision) {
        operation = "admin.organizer_verification_decide";
        const input = decideOrganizerVerificationSchema.safeParse(await requestBody(request));
        if (!input.success) return denied("invalid_request", "Complete the decision.", 400);
        const { error } = await admin.rpc("decide_organizer_verification_command", {
          p_actor_id: actorId,
          p_auth_session_id: actor.sessionId,
          p_control_confirmed: input.data.controlConfirmed ?? null,
          p_correlation_id: correlationId,
          p_decision: input.data.decision,
          p_organizer_profile_id: verificationDecision[1],
          p_reason: input.data.reason ?? null,
          p_registered_name: input.data.registeredName ?? null,
          p_registry_active: input.data.registryActive ?? null,
        });
        if (error) {
          const mapped = new Map<string, [string, string, number]>([
            ["Admin elevation required", ["elevation_required", "Enter admin mode first.", 403]],
            [
              "Cannot review own organizer",
              ["conflict_of_interest", "You manage this organizer.", 403],
            ],
            ["Verification unavailable", ["review_unavailable", "No such verification.", 409]],
            ["Invalid verification decision", ["invalid_request", "Complete the decision.", 400]],
          ]).get(error.message);
          if (mapped) return denied(mapped[0], mapped[1], mapped[2]);
          throw error;
        }
        status = "succeeded";
        return json(await adminStatus(), 200, correlationId, origin);
      }
      const adminEventRoute = route.match(
        /^\/admin\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/intervention)?$/iu,
      );
      if (adminEventRoute && request.method === "GET" && !adminEventRoute[2]) {
        operation = "admin.event_read";
        const { data, error } = await admin.rpc("admin_get_event_command", {
          p_actor_id: actorId,
          p_auth_session_id: actor.sessionId,
          p_correlation_id: correlationId,
          p_event_id: adminEventRoute[1],
        });
        if (error) {
          if (error.message === "Admin elevation required") {
            return denied("elevation_required", "Enter admin mode first.", 403);
          }
          if (error.message === "Event not found")
            return denied("not_found", "No such event.", 404);
          throw error;
        }
        const parsed = adminEventSummarySchema.safeParse(data);
        if (!parsed.success) throw new Error("invalid_internal_response");
        status = "succeeded";
        return json(parsed.data, 200, correlationId, origin);
      }
      if (adminEventRoute && request.method === "POST" && adminEventRoute[2]) {
        operation = "admin.event_intervention";
        const input = adminEventInterventionRequestSchema.safeParse(await requestBody(request));
        if (!input.success) return denied("invalid_request", "Give the required reasons.", 400);
        const { data, error } = await admin.rpc("admin_intervene_event_command", {
          p_action: input.data.action,
          p_actor_id: actorId,
          p_auth_session_id: actor.sessionId,
          p_correlation_id: correlationId,
          p_event_id: adminEventRoute[1],
          p_expected_event_version: input.data.expectedEventVersion,
          p_internal_reason: input.data.internalReason,
          p_public_reason: input.data.action === "end_early" ? null : input.data.publicReason,
        });
        if (error) {
          const mapped = new Map<string, [string, string, number]>([
            ["Admin elevation required", ["elevation_required", "Enter admin mode first.", 403]],
            ["Event not found", ["not_found", "No such event.", 404]],
            ["Event version conflict", ["version_conflict", "The event changed. Reload.", 409]],
            [
              "Only published events can be cancelled",
              ["invalid_state", "Only published events can be cancelled.", 409],
            ],
            [
              "Only active events can end early",
              ["invalid_state", "Only live events can end early.", 409],
            ],
            ["Invalid intervention", ["invalid_request", "Give the required reasons.", 400]],
            [
              "Only published or live events can be postponed",
              ["invalid_state", "Only published or live events can be postponed.", 409],
            ],
          ]).get(error.message);
          if (mapped) return denied(mapped[0], mapped[1], mapped[2]);
          throw error;
        }
        const parsed = eventLifecycleResultSchema.safeParse(data);
        if (!parsed.success) throw new Error("invalid_internal_response");
        status = "succeeded";
        return json(parsed.data, 200, correlationId, origin);
      }
      const adminErrors = new Map<string, [string, string, number]>([
        ["Admin elevation required", ["elevation_required", "Enter admin mode first.", 403]],
        ["Appeal unavailable", ["review_unavailable", "This appeal is no longer pending.", 409]],
        [
          "Invalid appeal decision",
          ["invalid_request", "Choose a decision and give a reason.", 400],
        ],
        [
          "Different reviewer required",
          ["different_reviewer_required", "Another administrator must review this.", 409],
        ],
        [
          "Platform restriction applies",
          ["platform_restricted", "Lift the platform restriction first.", 409],
        ],
        ["Reason required", ["reason_required", "Give a reason.", 400]],
        ["Account not found", ["not_found", "No account with that email.", 404]],
        ["Cannot restrict own account", ["forbidden", "You cannot restrict yourself.", 403]],
        ["Already restricted", ["invalid_state", "The account is already restricted.", 409]],
        ["Restriction not found", ["not_found", "No active restriction.", 404]],
        [
          "Approval unavailable",
          ["review_unavailable", "This approval is no longer pending.", 409],
        ],
        [
          "Different approver required",
          ["different_approver_required", "Another administrator must approve this.", 409],
        ],
        ["Report not found", ["not_found", "Report not found.", 404]],
      ]);
      const adminResult = <T>(
        result: { data: unknown; error: { message: string } | null },
        schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
      ) => {
        if (result.error) {
          const mapped = adminErrors.get(result.error.message);
          if (!mapped) throw result.error;
          return denied(mapped[0], mapped[1], mapped[2]);
        }
        const parsed = schema.safeParse(result.data);
        if (!parsed.success) throw new Error("invalid_internal_response");
        status = "succeeded";
        return json(parsed.data, 200, correlationId, origin);
      };
      const adminArgs = { p_actor_id: actorId, p_auth_session_id: actor.sessionId };
      if (request.method === "GET" && route === "/admin/operations") {
        operation = "admin.operations_read";
        return adminResult(
          await admin.rpc("admin_operations_command", adminArgs),
          adminOperationsSchema,
        );
      }
      const switchRoute = route.match(/^\/admin\/switches\/([a-z_]{3,40})$/u);
      if (request.method === "POST" && switchRoute) {
        operation = "admin.kill_switch_set";
        const key = killSwitchKeySchema.safeParse(switchRoute[1]);
        const input = setKillSwitchRequestSchema.safeParse(await requestBody(request));
        if (!key.success || !input.success) return denied("reason_required", "Give a reason.", 400);
        return adminResult(
          await admin.rpc("set_kill_switch_command", {
            ...adminArgs,
            p_correlation_id: correlationId,
            p_enabled: input.data.enabled,
            p_key: key.data,
            p_reason: input.data.reason,
          }),
          adminOperationsSchema,
        );
      }
      if (request.method === "GET" && route === "/admin/support") {
        operation = "admin.support_read";
        return adminResult(
          await admin.rpc("list_support_requests_command", adminArgs),
          supportRequestsSchema,
        );
      }
      const supportResolve = route.match(
        /^\/admin\/support\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/resolve$/iu,
      );
      if (request.method === "POST" && supportResolve) {
        operation = "admin.support_resolve";
        return adminResult(
          await admin.rpc("resolve_support_request_command", {
            ...adminArgs,
            p_correlation_id: correlationId,
            p_request_id: supportResolve[1],
          }),
          supportRequestsSchema,
        );
      }
      if (request.method === "GET" && route === "/admin/appeals") {
        operation = "admin.appeal_queue_read";
        return adminResult(
          await admin.rpc("list_appeals_command", {
            ...adminArgs,
            p_correlation_id: correlationId,
          }),
          appealQueueSchema,
        );
      }
      const appealDecision = route.match(
        /^\/admin\/appeals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/decision$/iu,
      );
      if (request.method === "POST" && appealDecision) {
        operation = "admin.appeal_decide";
        const input = decideAppealRequestSchema.safeParse(await requestBody(request));
        if (!input.success)
          return denied("invalid_request", "Choose a decision and give a reason.", 400);
        const decided = await admin.rpc("decide_appeal_command", {
          ...adminArgs,
          p_appeal_id: appealDecision[1],
          p_correlation_id: correlationId,
          p_decision: input.data.decision,
          p_reason: input.data.reason,
        });
        if (decided.error) return adminResult(decided, appealQueueSchema);
        return adminResult(
          await admin.rpc("list_appeals_command", {
            ...adminArgs,
            p_correlation_id: correlationId,
          }),
          appealQueueSchema,
        );
      }
      if (request.method === "POST" && route === "/admin/accounts/lookup") {
        operation = "admin.account_lookup";
        const input = adminFindAccountRequestSchema.safeParse(await requestBody(request));
        if (!input.success) return denied("invalid_request", "Give an email and a reason.", 400);
        return adminResult(
          await admin.rpc("admin_find_account_command", {
            ...adminArgs,
            p_correlation_id: correlationId,
            p_email: input.data.email,
            p_reason: input.data.reason,
          }),
          adminAccountSchema,
        );
      }
      const restrictRoute = route.match(
        /^\/admin\/accounts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/restrict$/iu,
      );
      if (request.method === "POST" && restrictRoute) {
        operation = "admin.account_restrict";
        const input = adminReasonRequestSchema.safeParse(await requestBody(request));
        if (!input.success) return denied("reason_required", "Give a reason.", 400);
        return adminResult(
          await admin.rpc("restrict_account_command", {
            ...adminArgs,
            p_account_id: restrictRoute[1],
            p_correlation_id: correlationId,
            p_reason: input.data.reason,
          }),
          adminAccountSchema,
        );
      }
      const liftRoute = route.match(
        /^\/admin\/restrictions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/lift$/iu,
      );
      if (request.method === "POST" && liftRoute) {
        operation = "admin.restriction_lift";
        const input = adminReasonRequestSchema.safeParse(await requestBody(request));
        if (!input.success) return denied("reason_required", "Give a reason.", 400);
        return adminResult(
          await admin.rpc("request_restriction_lift_command", {
            ...adminArgs,
            p_correlation_id: correlationId,
            p_reason: input.data.reason,
            p_restriction_id: liftRoute[1],
          }),
          restrictionLiftResultSchema,
        );
      }
      if (request.method === "GET" && route === "/admin/approvals") {
        operation = "admin.approvals_read";
        return adminResult(
          await admin.rpc("list_admin_approvals_command", adminArgs),
          adminApprovalsSchema,
        );
      }
      const approvalRoute = route.match(
        /^\/admin\/approvals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/decision$/iu,
      );
      if (request.method === "POST" && approvalRoute) {
        operation = "admin.approval_decide";
        const input = decideAdminApprovalRequestSchema.safeParse(await requestBody(request));
        if (!input.success) return denied("invalid_request", "Approve or reject.", 400);
        const decided = await admin.rpc("decide_admin_approval_command", {
          ...adminArgs,
          p_approval_id: approvalRoute[1],
          p_approve: input.data.approve,
          p_correlation_id: correlationId,
        });
        if (decided.error) return adminResult(decided, adminApprovalsSchema);
        return adminResult(
          await admin.rpc("list_admin_approvals_command", adminArgs),
          adminApprovalsSchema,
        );
      }
      if (request.method === "GET" && route === "/admin/cases") {
        operation = "admin.case_queue_read";
        return adminResult(
          await admin.rpc("admin_list_cases_command", {
            ...adminArgs,
            p_correlation_id: correlationId,
          }),
          adminCasesSchema,
        );
      }
      const contactRoute = route.match(
        /^\/admin\/reports\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/contact$/iu,
      );
      if (request.method === "POST" && contactRoute) {
        operation = "admin.report_contact_read";
        const input = adminReasonRequestSchema.safeParse(await requestBody(request));
        if (!input.success) return denied("reason_required", "Give a reason.", 400);
        return adminResult(
          await admin.rpc("admin_read_report_contact_command", {
            ...adminArgs,
            p_correlation_id: correlationId,
            p_reason: input.data.reason,
            p_report_id: contactRoute[1],
          }),
          reportContactSchema,
        );
      }
      const decisionRoute = route.match(
        /^\/admin\/reviews\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/decision$/iu,
      );
      if (request.method === "POST" && decisionRoute) {
        operation = "admin.first_review_decide";
        const input = decideFirstEventReviewSchema.safeParse(await requestBody(request));
        if (!input.success)
          return denied("invalid_request", "Choose a decision and give a reason.", 400);
        const { error } = await admin.rpc("decide_first_event_review_command", {
          p_actor_id: actorId,
          p_auth_session_id: actor.sessionId,
          p_correlation_id: correlationId,
          p_decision: input.data.decision,
          p_event_id: decisionRoute[1],
          p_expected_event_version: input.data.expectedEventVersion,
          p_reason: input.data.reason,
        });
        if (error) {
          const mapped = new Map<string, [string, string, number]>([
            ["Admin elevation required", ["elevation_required", "Enter admin mode first.", 403]],
            [
              "Cannot review own event",
              ["conflict_of_interest", "You cannot review your own event.", 403],
            ],
            [
              "Review unavailable",
              ["review_unavailable", "This review is no longer pending.", 409],
            ],
            [
              "Event version conflict",
              ["version_conflict", "The event changed after submission.", 409],
            ],
            [
              "Invalid review decision",
              ["invalid_request", "Choose a decision and give a reason.", 400],
            ],
          ]).get(error.message);
          if (mapped) return denied(mapped[0], mapped[1], mapped[2]);
          throw error;
        }
        status = "succeeded";
        return json(await adminStatus(), 200, correlationId, origin);
      }
    }

    const publicationReadinessRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/publication-readiness$/iu,
    );
    if (request.method === "GET" && publicationReadinessRoute) {
      operation = "event.publication_readiness_read";
      const { data, error } = await admin.rpc("get_event_publication_readiness_command", {
        p_actor_id: actorId,
        p_event_id: publicationReadinessRoute[1],
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventPublicationReadinessSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const publicationAttestationRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/publication-attestation$/iu,
    );
    if (request.method === "POST" && publicationAttestationRoute) {
      operation = "event.publication_attest";
      const input = attestEventPublicationRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Confirm both publication statements.",
          400,
          correlationId,
          origin,
        );
      }
      const eventId = publicationAttestationRoute[1];
      const { error } = await admin.rpc("attest_event_publication_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
        p_event_id: eventId,
        p_expected_boundary_version: input.data.expectedBoundaryVersion,
        p_expected_event_version: input.data.expectedEventVersion,
        p_expected_registration_version: input.data.expectedRegistrationVersion,
        p_location_authority_confirmed: input.data.locationAuthorityConfirmed,
        p_visibility_understood: input.data.visibilityUnderstood,
      });
      if (error) {
        const knownError = new Map<string, [string, string, number]>([
          [
            "Only the event owner can attest publication",
            ["forbidden", "Only the event owner can confirm publication.", 403],
          ],
          [
            "Recent authentication required",
            ["recent_auth_required", "Sign in again before confirming publication.", 403],
          ],
          [
            "Only draft events can be attested",
            ["invalid_state", "Only draft events can be confirmed here.", 409],
          ],
          [
            "Event version conflict",
            ["version_conflict", "The event changed. Reload and try again.", 409],
          ],
          [
            "Publication configuration version conflict",
            ["version_conflict", "The event setup changed. Reload and try again.", 409],
          ],
        ]);
        const mapped = knownError.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const { data, error: readinessError } = await admin.rpc(
        "get_event_publication_readiness_command",
        { p_actor_id: actorId, p_event_id: eventId },
      );
      if (readinessError) throw readinessError;
      const parsed = eventPublicationReadinessSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const createTeamInviteRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/invites$/iu,
    );
    if (request.method === "POST" && createTeamInviteRoute) {
      operation = "event.team_invite_create";
      const input = inviteEventTeamMemberRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Check the invitation email and role.",
          400,
          correlationId,
          origin,
        );
      }
      const { data, error } = await admin.rpc("invite_event_team_member_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
        p_email: input.data.email,
        p_event_id: createTeamInviteRoute[1],
        p_expected_team_version: input.data.expectedTeamVersion,
        p_role: input.data.role,
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 201, correlationId, origin);
    }

    const teamInviteRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/invites\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu,
    );
    if (request.method === "DELETE" && teamInviteRoute) {
      operation = "event.team_invite_cancel";
      const input = eventTeamVersionRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Reload the event team.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("cancel_event_team_invite_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
        p_event_id: teamInviteRoute[1],
        p_expected_team_version: input.data.expectedTeamVersion,
        p_invite_id: teamInviteRoute[2],
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const createOwnershipTransferRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/ownership-transfers$/iu,
    );
    if (request.method === "POST" && createOwnershipTransferRoute) {
      operation = "event.ownership_transfer_initiate";
      const input = initiateEventOwnershipTransferRequestSchema.safeParse(
        await requestBody(request),
      );
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Choose an eligible co-host.",
          400,
          correlationId,
          origin,
        );
      }
      const { data, error } = await admin.rpc("initiate_event_ownership_transfer_v2_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
        p_event_id: createOwnershipTransferRoute[1],
        p_expected_team_version: input.data.expectedTeamVersion,
        p_target_organizer_profile_id: input.data.targetOrganizerProfileId,
        p_to_membership_id: input.data.toMembershipId,
      });
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 201, correlationId, origin);
    }

    const ownershipTransferRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/ownership-transfers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/accept)?$/iu,
    );
    if (
      ownershipTransferRoute &&
      ((request.method === "DELETE" && !ownershipTransferRoute[3]) ||
        (request.method === "POST" && ownershipTransferRoute[3] === "/accept"))
    ) {
      const accepting = request.method === "POST";
      operation = accepting ? "event.ownership_transfer_accept" : "event.ownership_transfer_cancel";
      const input = eventTeamVersionRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Reload the event team.", 400, correlationId, origin);
      }
      const rpcName = accepting
        ? "accept_event_ownership_transfer_command"
        : "cancel_event_ownership_transfer_command";
      const parameters: Record<string, unknown> = {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_event_id: ownershipTransferRoute[1],
        p_expected_team_version: input.data.expectedTeamVersion,
        p_transfer_id: ownershipTransferRoute[2],
      };
      if (!accepting) parameters.p_authenticated_at = actor.authenticatedAt;
      const { data, error } = await admin.rpc(rpcName, parameters);
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const teamMemberRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/team\/members\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu,
    );
    if ((request.method === "PUT" || request.method === "DELETE") && teamMemberRoute) {
      operation = request.method === "PUT" ? "event.team_role_update" : "event.team_member_remove";
      const rawBody = await requestBody(request);
      const input =
        request.method === "PUT"
          ? updateEventTeamMemberRoleRequestSchema.safeParse(rawBody)
          : eventTeamVersionRequestSchema.safeParse(rawBody);
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Reload the event team.", 400, correlationId, origin);
      }
      const rpcName =
        request.method === "PUT"
          ? "update_event_team_member_role_command"
          : "remove_event_team_member_command";
      const parameters: Record<string, unknown> = {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_correlation_id: correlationId,
        p_event_id: teamMemberRoute[1],
        p_expected_team_version: input.data.expectedTeamVersion,
        p_membership_id: teamMemberRoute[2],
      };
      if (request.method === "PUT" && "role" in input.data) parameters.p_role = input.data.role;
      const { data, error } = await admin.rpc(rpcName, parameters);
      if (error) {
        const mapped = teamCommandErrors.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventTeamSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const eventRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu,
    );
    if (request.method === "DELETE" && eventRoute) {
      operation = "event.draft_delete";
      const input = deleteDraftEventRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Confirm the exact event title before deleting.",
          400,
          correlationId,
          origin,
        );
      }

      const { data, error } = await admin.rpc("delete_draft_event_command", {
        p_actor_id: actorId,
        p_authenticated_at: actor.authenticatedAt,
        p_confirm_title: input.data.confirmTitle,
        p_correlation_id: correlationId,
        p_event_id: eventRoute[1],
        p_expected_version: input.data.expectedVersion,
      });

      if (error) {
        const knownError = new Map<string, [string, string, number]>([
          [
            "Only the event owner can delete a draft",
            ["forbidden", "Only the event owner can delete this draft.", 403],
          ],
          [
            "Only draft events can be deleted",
            ["invalid_state", "Only draft events can be deleted.", 409],
          ],
          [
            "Event version conflict",
            ["version_conflict", "The event changed. Reload it and try again.", 409],
          ],
          [
            "Event title confirmation does not match",
            ["confirmation_mismatch", "Enter the exact event title to delete it.", 400],
          ],
          [
            "Recent authentication required",
            ["recent_auth_required", "Sign in again before deleting this draft.", 403],
          ],
        ]);
        const mapped = knownError.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }

      const parsed = commandResourceResponseSchema.safeParse({ id: data, schemaVersion: "1.0" });
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const sellerErrors = new Map<string, [string, string, number]>([
      ["Applications paused", ["paused", "Applications are paused. Try again later.", 503]],
      ["Event not found", ["not_found", "Event not found.", 404]],
      ["Participation not found", ["not_found", "Application not found.", 404]],
      [
        "Actor is not an event team member",
        ["forbidden", "Only the event team can see sellers.", 403],
      ],
      [
        "Actor cannot manage admission",
        ["forbidden", "Only the owner or a co-host can change this.", 403],
      ],
      ["Event is invite-only", ["invite_only", "This event only takes invited sellers.", 409]],
      ["Registration is closed", ["registration_closed", "Registration is closed.", 409]],
      ["Already applied", ["already_applied", "You have already applied.", 409]],
      ["Application limit reached", ["rate_limited", "Too many applications today.", 429]],
      ["Event area not ready", ["area_not_ready", "The event area is not ready yet.", 409]],
      ["Invalid application", ["invalid_request", "Check the application fields.", 400]],
      [
        "Right to use the location must be confirmed",
        ["invalid_request", "Confirm that you may use the location.", 400],
      ],
      [
        "Participation version conflict",
        ["version_conflict", "The application changed. Reload.", 409],
      ],
      [
        "Participation already closed",
        ["invalid_state", "The application is already closed.", 409],
      ],
      ["Event is closed", ["invalid_state", "The event is closed.", 409]],
      [
        "Cannot decide own participation",
        ["conflict_of_interest", "You cannot decide your own application.", 403],
      ],
      ["Seller places are full", ["places_full", "All seller places are taken.", 409]],
      ["Invalid seller decision", ["invalid_request", "That decision is not possible.", 400]],
      ["Admission can no longer change", ["invalid_state", "Admission can no longer change.", 409]],
      ["Event version conflict", ["version_conflict", "The event changed. Reload.", 409]],
      ["Invalid admission settings", ["invalid_request", "Check the admission settings.", 400]],
      [
        "Shared entrance question",
        ["shared_entrance_question", "Someone already sells at this address.", 409],
      ],
      ["Address cannot change now", ["invalid_state", "The address cannot change now.", 409]],
      [
        "Actor cannot review locations",
        ["forbidden", "Only the owner or a co-host can do this.", 403],
      ],
      ["Location not found", ["not_found", "Location not found.", 404]],
      ["Location cannot be split", ["invalid_request", "Only a shared stop can be split.", 400]],
      ["Invalid location review", ["invalid_request", "Check the location review.", 400]],
      ["Recent authentication required", ["recent_auth_required", "Sign in again first.", 403]],
      ["Invalid pin correction", ["invalid_request", "Give a reason and a point.", 400]],
      [
        "Pin correction too large",
        ["correction_too_large", "Larger moves need a new address.", 400],
      ],
      ["Geocoding limit reached", ["rate_limited", "Place the pin by hand for now.", 429]],
      [
        "Actor cannot configure categories",
        ["forbidden", "Only the owner or a co-host can do this.", 403],
      ],
      [
        "Categories are pinned after publication",
        ["invalid_state", "Categories cannot change after publication.", 409],
      ],
      ["Taxonomy version conflict", ["version_conflict", "The categories changed. Reload.", 409]],
      ["Invalid category settings", ["invalid_request", "Check the categories and tags.", 400]],
      ["Listing version conflict", ["version_conflict", "The listing changed. Reload.", 409]],
      ["Invalid listing", ["invalid_request", "Check the listing.", 400]],
      ["Describe what Other means", ["other_needs_description", "Describe what you sell.", 400]],
      [
        "Availability must be within the event",
        ["invalid_availability", "Times must be within the event and not overlap.", 400],
      ],
      ["Reason required", ["reason_required", "Give a reason.", 400]],
      ["Live status only during the event", ["invalid_state", "Only during the event.", 409]],
      [
        "Only approved sellers have a live status",
        ["invalid_state", "Only approved sellers.", 409],
      ],
      ["Invalid live status", ["invalid_request", "Check the status.", 400]],
      ["Closed for the day", ["closed_for_day", "You have closed for the day.", 409]],
      ["Case not found", ["not_found", "Case not found.", 404]],
      ["Case already closed", ["invalid_state", "The case is already closed.", 409]],
      ["Invalid case decision", ["invalid_request", "Choose a decision and give a reason.", 400]],
      [
        "Restore or uphold a quarantined location",
        ["quarantine_needs_decision", "Restore or uphold the quarantined location.", 409],
      ],
      [
        "Platform restriction applies",
        [
          "platform_restricted",
          "A platform restriction applies. Only an administrator can lift it.",
          409,
        ],
      ],
      ["Invalid moderation action", ["invalid_request", "That action is not possible.", 400]],
      ["Action not found", ["not_found", "Decision not found.", 404]],
      [
        "Appeal window closed",
        ["appeal_window_closed", "The 30-day appeal window has closed.", 409],
      ],
      ["Already appealed", ["already_appealed", "You have already appealed this decision.", 409]],
      [
        "Invalid appeal",
        ["invalid_request", "Explain the appeal in at least ten characters.", 400],
      ],
      [
        "Actor cannot invite sellers",
        ["forbidden", "Only the owner or a co-host can invite.", 403],
      ],
      ["Invalid invitation", ["invalid_request", "Enter a valid email address.", 400]],
      ["Invitation limit reached", ["rate_limited", "Too many invitations for this event.", 429]],
      ["Invitation not found", ["not_found", "The invitation is gone or expired.", 404]],
      [
        "Only the owner or a co-host can postpone",
        ["forbidden", "Only the owner or a co-host can postpone.", 403],
      ],
      [
        "Only the owner or a co-host can reschedule",
        ["forbidden", "Only the owner or a co-host can reschedule.", 403],
      ],
      [
        "Only published or live events can be postponed",
        ["invalid_state", "Only published or live events can be postponed.", 409],
      ],
      ["Postponement reason required", ["invalid_request", "Give a public reason.", 400]],
      [
        "Only postponed events can be rescheduled",
        ["invalid_state", "Only postponed events can be rescheduled.", 409],
      ],
      [
        "Reschedule window closed",
        ["reschedule_window_closed", "The 14 days to set a new date have passed.", 409],
      ],
      [
        "Invalid replacement date",
        ["invalid_replacement_date", "Pick a future date at most 30 days after the original.", 400],
      ],
      ["Nothing to confirm", ["invalid_state", "Nothing to confirm.", 409]],
      ["Wait for the new date", ["invalid_state", "The new date is not set yet.", 409]],
    ]);
    const sellerResult = <T>(
      result: { data: unknown; error: { message: string } | null },
      schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
      httpStatus = 200,
    ) => {
      if (result.error) {
        const mapped = sellerErrors.get(result.error.message);
        if (!mapped) throw result.error;
        status = "denied";
        return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
      }
      const parsed = schema.safeParse(result.data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, httpStatus, correlationId, origin);
    };

    const sellerEventRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(seller-view|participation|sellers|admission|geocode|location-review|taxonomy|cases)$/iu,
    );
    if (sellerEventRoute) {
      const [, eventId, action] = sellerEventRoute;
      if (request.method === "GET" && action === "seller-view") {
        operation = "seller.event_read";
        return sellerResult(
          await admin.rpc("get_event_for_seller_command", {
            p_actor_id: actorId,
            p_event_id: eventId,
          }),
          eventForSellerSchema,
        );
      }
      if (request.method === "POST" && action === "participation") {
        operation = "seller.apply";
        const input = applyToEventRequestSchema.safeParse(await requestBody(request));
        if (!input.success) {
          status = "denied";
          return apiError(
            "invalid_request",
            "Check the application fields.",
            400,
            correlationId,
            origin,
          );
        }
        return sellerResult(
          await admin.rpc("apply_to_event_command", {
            p_actor_id: actorId,
            p_address_line: input.data.addressLine,
            p_correlation_id: correlationId,
            p_display_name: input.data.displayName,
            p_event_id: eventId,
            p_latitude: input.data.latitude,
            p_locality: input.data.locality,
            p_longitude: input.data.longitude,
            p_placement: input.data.placement,
            p_postal_code: input.data.postalCode,
            p_right_to_use_attested: input.data.rightToUseAttested,
            p_shares_entrance: input.data.sharesEntrance,
          }),
          sellerParticipationSchema,
          201,
        );
      }
      if (request.method === "POST" && action === "geocode") {
        operation = "seller.geocode";
        const input = geocodeRequestSchema.safeParse(await requestBody(request));
        if (!input.success) {
          status = "denied";
          return apiError("invalid_request", "Check the address.", 400, correlationId, origin);
        }
        const geocoder = configuredGeocoder((name) => Deno.env.get(name));
        const notFound = { found: false, latitude: null, longitude: null };
        if (!geocoder) {
          status = "succeeded";
          return json(notFound, 200, correlationId, origin);
        }
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(`${geocoder.provider}|${normalizedGeocodeKey(input.data)}`),
        );
        const queryHash = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const cached = await admin.rpc("read_geocode_cache_command", { p_query_hash: queryHash });
        if (cached.error) throw cached.error;
        if (cached.data) {
          const { found, latitude, longitude } = cached.data as Record<string, unknown>;
          return sellerResult(
            { data: { found, latitude, longitude }, error: null },
            geocodeResultSchema,
          );
        }
        const reserved = await admin.rpc("reserve_geocode_request_command", {
          p_actor_id: actorId,
          p_event_id: eventId,
        });
        if (reserved.error) return sellerResult(reserved, geocodeResultSchema);
        let point: { longitude: number; latitude: number } | null;
        try {
          point = await geocoder.lookup(input.data);
        } catch {
          // Provider trouble degrades to the manual pin and is not cached.
          status = "succeeded";
          return json(notFound, 200, correlationId, origin);
        }
        const stored = await admin.rpc("store_geocode_cache_command", {
          p_latitude: point?.latitude ?? null,
          p_longitude: point?.longitude ?? null,
          p_provider: geocoder.provider,
          p_query_hash: queryHash,
        });
        if (stored.error) throw stored.error;
        status = "succeeded";
        return json(point ? { found: true, ...point } : notFound, 200, correlationId, origin);
      }
      if (action === "cases" && request.method === "GET") {
        operation = "moderation.cases_read";
        return sellerResult(
          await admin.rpc("list_event_cases_command", { p_actor_id: actorId, p_event_id: eventId }),
          moderationCasesSchema,
        );
      }
      if (action === "taxonomy" && request.method === "GET") {
        operation = "event.taxonomy_read";
        return sellerResult(
          await admin.rpc("get_event_taxonomy_command", {
            p_actor_id: actorId,
            p_event_id: eventId,
          }),
          eventTaxonomySchema,
        );
      }
      if (action === "taxonomy" && request.method === "PUT") {
        operation = "event.taxonomy_save";
        const input = saveEventTaxonomyRequestSchema.safeParse(await requestBody(request));
        if (!input.success) {
          status = "denied";
          return apiError(
            "invalid_request",
            "Check the categories and tags.",
            400,
            correlationId,
            origin,
          );
        }
        return sellerResult(
          await admin.rpc("save_event_taxonomy_command", {
            p_actor_id: actorId,
            p_correlation_id: correlationId,
            p_enabled_category_ids: input.data.enabledCategoryIds,
            p_event_id: eventId,
            p_expected_version: input.data.expectedVersion,
            p_suggested_tags: input.data.suggestedTags,
          }),
          eventTaxonomySchema,
        );
      }
      if (request.method === "POST" && action === "location-review") {
        operation = "location.review";
        const input = locationReviewRequestSchema.safeParse(await requestBody(request));
        if (!input.success) {
          status = "denied";
          return apiError(
            "invalid_request",
            "Check the location review.",
            400,
            correlationId,
            origin,
          );
        }
        return sellerResult(
          await admin.rpc("review_event_location_command", {
            p_action: input.data.action,
            p_actor_id: actorId,
            p_correlation_id: correlationId,
            p_event_id: eventId,
            p_location_id: input.data.locationId,
            p_participation_id: input.data.action === "split" ? input.data.participationId : null,
            p_target_location_id:
              input.data.action === "merge" ? input.data.targetLocationId : null,
          }),
          eventSellersSchema,
        );
      }
      if (request.method === "GET" && action === "sellers") {
        operation = "seller.team_list";
        return sellerResult(
          await admin.rpc("list_event_sellers_command", {
            p_actor_id: actorId,
            p_event_id: eventId,
          }),
          eventSellersSchema,
        );
      }
      if (request.method === "PUT" && action === "admission") {
        operation = "event.admission_update";
        const input = updateEventAdmissionRequestSchema.safeParse(await requestBody(request));
        if (!input.success) {
          status = "denied";
          return apiError(
            "invalid_request",
            "Check the admission settings.",
            400,
            correlationId,
            origin,
          );
        }
        return sellerResult(
          await admin.rpc("update_event_admission_command", {
            p_actor_id: actorId,
            p_admission_mode: input.data.admissionMode,
            p_correlation_id: correlationId,
            p_event_id: eventId,
            p_expected_version: input.data.expectedVersion,
            p_waitlist_promotion_paused: input.data.waitlistPromotionPaused,
          }),
          eventSellersSchema,
        );
      }
    }

    if (request.method === "GET" && route === "/participations") {
      operation = "seller.own_list";
      return sellerResult(
        await admin.rpc("list_my_participations_command", { p_actor_id: actorId }),
        myParticipationsSchema,
      );
    }

    if (route === "/notifications" && request.method === "GET") {
      operation = "account.notifications_read";
      const { data, error } = await admin.rpc("list_account_notifications_command", {
        p_actor_id: actorId,
      });
      if (error) throw error;
      status = "succeeded";
      return json(accountNotificationsSchema.parse(data), 200, correlationId, origin);
    }
    if (route === "/notifications/read" && request.method === "POST") {
      operation = "account.notifications_mark_read";
      const input = markNotificationsReadRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Check the request.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("mark_account_notifications_read_command", {
        p_actor_id: actorId,
        p_notification_id: input.data.notificationId ?? null,
      });
      if (error) throw error;
      status = "succeeded";
      return json(accountNotificationsSchema.parse(data), 200, correlationId, origin);
    }
    if (
      route === "/account/notification-preferences" &&
      (request.method === "GET" || request.method === "PUT")
    ) {
      operation = "account.notification_preferences";
      const input =
        request.method === "PUT"
          ? notificationPreferencesSchema.safeParse(await requestBody(request))
          : null;
      if (input && !input.success) {
        status = "denied";
        return apiError("invalid_request", "Check the request.", 400, correlationId, origin);
      }
      const { data, error } = input?.success
        ? await admin.rpc("set_notification_preferences_command", {
            p_actor_id: actorId,
            p_event_reminders: input.data.eventReminders,
          })
        : await admin.rpc("get_notification_preferences_command", { p_actor_id: actorId });
      if (error) throw error;
      status = "succeeded";
      return json(notificationPreferencesSchema.parse(data), 200, correlationId, origin);
    }

    const feedbackSummary = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/feedback-summary$/iu,
    );
    if (request.method === "GET" && feedbackSummary) {
      operation = "feedback.summary";
      const { data, error } = await admin.rpc("event_feedback_summary_command", {
        p_actor_id: actorId,
        p_event_id: feedbackSummary[1],
      });
      if (error) {
        status = "denied";
        return apiError("forbidden", "You are not on this event team.", 403, correlationId, origin);
      }
      status = "succeeded";
      return json(eventFeedbackSummarySchema.parse(data), 200, correlationId, origin);
    }

    const messagesRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/messages(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/reply)?$/iu,
    );
    if (messagesRoute && (request.method === "GET" || request.method === "POST")) {
      const [, eventId, threadId] = messagesRoute;
      const failure = (message: string) => {
        const mapped = new Map<string, [string, string, number]>([
          [
            "Actor cannot read organizer messages",
            ["forbidden", "Only hosts read organizer messages.", 403],
          ],
          ["Thread not found", ["not_found", "This conversation is not available.", 404]],
          ["Relay closed", ["relay_closed", "This event no longer takes messages.", 409]],
          ["Invalid message", ["invalid_request", "Check the message.", 400]],
          ["Message limit reached", ["rate_limited", "Too many messages. Try again later.", 429]],
        ]).get(message);
        if (!mapped) return null;
        status = "denied";
        return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
      };
      if (request.method === "GET" && !threadId) {
        operation = "relay.team_read";
        const { data, error } = await admin.rpc("list_relay_threads_command", {
          p_actor_id: actorId,
          p_event_id: eventId,
        });
        if (error) {
          const denied = failure(error.message);
          if (denied) return denied;
          throw error;
        }
        status = "succeeded";
        return json(relayThreadsSchema.parse(data), 200, correlationId, origin);
      }
      if (request.method === "POST" && threadId) {
        operation = "relay.team_reply";
        const input = relayTeamReplySchema.safeParse(await requestBody(request));
        if (!input.success) return failure("Invalid message") as Response;
        const { data, error } = await admin.rpc("reply_relay_thread_command", {
          p_actor_id: actorId,
          p_body: input.data.message,
          p_thread_id: threadId,
          p_token: null,
        });
        if (error) {
          const denied = failure(error.message);
          if (denied) return denied;
          throw error;
        }
        status = "succeeded";
        return json(relayThreadSchema.parse(data), 200, correlationId, origin);
      }
    }

    const exportRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/exports(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/download)?$/iu,
    );
    if (exportRoute && request.method === "POST") {
      const [, eventId, exportId] = exportRoute;
      const exportErrors = new Map<string, [string, string, number]>([
        ["Actor cannot export", ["forbidden", "Only hosts can export.", 403]],
        ["Recent authentication required", ["recent_auth_required", "Sign in again first.", 403]],
        [
          "Export already active",
          ["export_active", "An export is already waiting to be downloaded.", 409],
        ],
        ["Export limit reached", ["rate_limited", "Three exports a day. Try again tomorrow.", 429]],
        ["Export unavailable", ["gone", "This export is no longer available.", 410]],
        ["Exports paused", ["paused", "Exports are paused. Try again later.", 503]],
      ]);
      const exportFailure = (error: { message: string }) => {
        const mapped = exportErrors.get(error.message);
        if (!mapped) throw error;
        status = "denied";
        return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
      };
      if (!exportId) {
        operation = "event.export_create";
        const token = [...crypto.getRandomValues(new Uint8Array(32))]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const { data, error } = await admin.rpc("request_event_export_command", {
          p_actor_id: actorId,
          p_authenticated_at: actor.authenticatedAt,
          p_correlation_id: correlationId,
          p_event_id: eventId,
          p_token: token,
        });
        if (error) return exportFailure(error);
        status = "succeeded";
        return json(eventExportCreatedSchema.parse({ ...data, token }), 201, correlationId, origin);
      }
      operation = "event.export_download";
      const input = relayTokenRequestSchema.safeParse(await requestBody(request));
      if (!input.success) return exportFailure({ message: "Export unavailable" });
      const { data, error } = await admin.rpc("download_event_export_command", {
        p_actor_id: actorId,
        p_export_id: exportId,
        p_token: input.data.token,
      });
      if (error) return exportFailure(error);
      status = "succeeded";
      return new Response(data, {
        status: 200,
        headers: {
          ...corsHeaders(origin),
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="promenadis-sellers-${eventId.slice(0, 8)}.csv"`,
          "content-type": "text/csv; charset=utf-8",
          "x-content-type-options": "nosniff",
          "x-correlation-id": correlationId,
        },
      });
    }

    const appealRoute = route.match(
      /^\/moderation\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/appeal$/iu,
    );
    if (request.method === "POST" && appealRoute) {
      operation = "moderation.appeal";
      const input = submitAppealRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Explain the appeal in at least ten characters.",
          400,
          correlationId,
          origin,
        );
      }
      return sellerResult(
        await admin.rpc("submit_appeal_command", {
          p_action_id: appealRoute[1],
          p_actor_id: actorId,
          p_correlation_id: correlationId,
          p_statement: input.data.statement,
        }),
        myModerationSchema,
      );
    }

    const eventInvitesRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/seller-invites$/iu,
    );
    if (eventInvitesRoute && (request.method === "GET" || request.method === "POST")) {
      if (request.method === "GET") {
        operation = "seller.invites_read";
        return sellerResult(
          await admin.rpc("list_seller_invites_command", {
            p_actor_id: actorId,
            p_event_id: eventInvitesRoute[1],
          }),
          sellerInvitesSchema,
        );
      }
      operation = "seller.invite";
      const input = inviteSellerRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Enter a valid email address.",
          400,
          correlationId,
          origin,
        );
      }
      return sellerResult(
        await admin.rpc("invite_seller_command", {
          p_actor_id: actorId,
          p_correlation_id: correlationId,
          p_email: input.data.email,
          p_event_id: eventInvitesRoute[1],
        }),
        sellerInvitesSchema,
      );
    }

    if (request.method === "GET" && route === "/seller-invites") {
      operation = "seller.incoming_invites_read";
      return sellerResult(
        await admin.rpc("get_incoming_seller_invites_command", { p_actor_id: actorId }),
        incomingSellerInvitesSchema,
      );
    }

    const sellerInviteRoute = route.match(
      /^\/seller-invites\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/accept)?$/iu,
    );
    if (sellerInviteRoute && request.method === "DELETE" && !sellerInviteRoute[2]) {
      operation = "seller.invite_cancel";
      return sellerResult(
        await admin.rpc("cancel_seller_invite_command", {
          p_actor_id: actorId,
          p_correlation_id: correlationId,
          p_invite_id: sellerInviteRoute[1],
        }),
        sellerInvitesSchema,
      );
    }
    if (sellerInviteRoute && request.method === "POST" && sellerInviteRoute[2]) {
      operation = "seller.invite_accept";
      const input = applyToEventRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Check the application fields.",
          400,
          correlationId,
          origin,
        );
      }
      return sellerResult(
        await admin.rpc("accept_seller_invite_command", {
          p_actor_id: actorId,
          p_address_line: input.data.addressLine,
          p_correlation_id: correlationId,
          p_display_name: input.data.displayName,
          p_invite_id: sellerInviteRoute[1],
          p_latitude: input.data.latitude,
          p_locality: input.data.locality,
          p_longitude: input.data.longitude,
          p_placement: input.data.placement,
          p_postal_code: input.data.postalCode,
          p_right_to_use_attested: input.data.rightToUseAttested,
          p_shares_entrance: input.data.sharesEntrance,
        }),
        sellerParticipationSchema,
        201,
      );
    }

    const postponeRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(postpone|reschedule)$/iu,
    );
    if (request.method === "POST" && postponeRoute) {
      const [, eventId, action] = postponeRoute;
      operation = `event.${action}`;
      const body = await requestBody(request);
      const postpone = action === "postpone" ? postponeEventRequestSchema.safeParse(body) : null;
      const reschedule =
        action === "reschedule" ? rescheduleEventRequestSchema.safeParse(body) : null;
      if (!(postpone?.success || reschedule?.success)) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Check the reason or the dates.",
          400,
          correlationId,
          origin,
        );
      }
      return sellerResult(
        postpone?.success
          ? await admin.rpc("postpone_event_command", {
              p_actor_id: actorId,
              p_authenticated_at: actor.authenticatedAt,
              p_correlation_id: correlationId,
              p_event_id: eventId,
              p_expected_event_version: postpone.data.expectedEventVersion,
              p_public_reason: postpone.data.publicReason,
            })
          : await admin.rpc("reschedule_event_command", {
              p_actor_id: actorId,
              p_authenticated_at: actor.authenticatedAt,
              p_correlation_id: correlationId,
              p_ends_at: reschedule?.data?.endsAt,
              p_event_id: eventId,
              p_expected_event_version: reschedule?.data?.expectedEventVersion,
              p_starts_at: reschedule?.data?.startsAt,
            }),
        eventLifecycleResultSchema,
      );
    }

    const reconfirmRoute = route.match(
      /^\/participations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/reschedule-confirmation$/iu,
    );
    if (request.method === "POST" && reconfirmRoute) {
      operation = "seller.reschedule_confirm";
      const input = confirmRescheduleRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Accept or decline.", 400, correlationId, origin);
      }
      return sellerResult(
        await admin.rpc("confirm_reschedule_command", {
          p_accept: input.data.accept,
          p_actor_id: actorId,
          p_correlation_id: correlationId,
          p_participation_id: reconfirmRoute[1],
        }),
        sellerParticipationSchema,
      );
    }

    const caseRoute = route.match(
      /^\/cases\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/review$/iu,
    );
    if (request.method === "POST" && caseRoute) {
      operation = "moderation.case_review";
      const input = reviewCaseRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Choose a decision and give a reason.",
          400,
          correlationId,
          origin,
        );
      }
      return sellerResult(
        await admin.rpc("review_moderation_case_command", {
          p_actor_id: actorId,
          p_case_id: caseRoute[1],
          p_correlation_id: correlationId,
          p_decision: input.data.decision,
          p_reason: input.data.reason,
        }),
        moderationCasesSchema,
      );
    }

    if (request.method === "GET" && route === "/moderation") {
      operation = "moderation.own_read";
      return sellerResult(
        await admin.rpc("list_my_moderation_command", { p_actor_id: actorId }),
        myModerationSchema,
      );
    }

    const moderationRoute = route.match(
      /^\/participations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/moderation$/iu,
    );
    if (request.method === "POST" && moderationRoute) {
      operation = "moderation.participation";
      const input = moderateParticipationRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "That action is not possible.",
          400,
          correlationId,
          origin,
        );
      }
      return sellerResult(
        await admin.rpc("moderate_participation_command", {
          p_action: input.data.action,
          p_actor_id: actorId,
          p_correlation_id: correlationId,
          p_item_id: input.data.itemId,
          p_participation_id: moderationRoute[1],
          p_reason: input.data.reason,
        }),
        sellerParticipationSchema,
      );
    }

    const listingRoute = route.match(
      /^\/participations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(listing|live-status)$/iu,
    );
    if (listingRoute) {
      const [, participationId, action] = listingRoute;
      if (action === "listing" && request.method === "GET") {
        operation = "seller.listing_read";
        return sellerResult(
          await admin.rpc("get_seller_listing_command", {
            p_actor_id: actorId,
            p_participation_id: participationId,
          }),
          sellerListingSchema,
        );
      }
      if (action === "listing" && request.method === "PUT") {
        operation = "seller.listing_save";
        const input = saveSellerListingRequestSchema.safeParse(await requestBody(request));
        if (!input.success) {
          status = "denied";
          return apiError("invalid_request", "Check the listing.", 400, correlationId, origin);
        }
        const { accessibility } = input.data;
        return sellerResult(
          await admin.rpc("save_seller_listing_command", {
            p_actor_id: actorId,
            p_availability: input.data.availability,
            p_category_ids: input.data.categoryIds,
            p_correlation_id: correlationId,
            p_description: input.data.description,
            p_early_visibility_opt_out: input.data.earlyVisibilityOptOut,
            p_elevator: accessibility.elevator,
            p_expected_version: input.data.expectedVersion,
            p_items: input.data.items,
            p_participation_id: participationId,
            p_setting: accessibility.setting,
            p_stairs: accessibility.stairs,
            p_step_free: accessibility.stepFree,
            p_stroller_friendly: accessibility.strollerFriendly,
            p_tags: input.data.tags,
            p_title: input.data.title || null,
          }),
          sellerListingSchema,
        );
      }
      if (action === "live-status" && request.method === "POST") {
        operation = "seller.live_status";
        const input = setLiveStatusRequestSchema.safeParse(await requestBody(request));
        if (!input.success) {
          status = "denied";
          return apiError("invalid_request", "Check the status.", 400, correlationId, origin);
        }
        return sellerResult(
          await admin.rpc("set_seller_live_status_command", {
            p_actor_id: actorId,
            p_correlation_id: correlationId,
            p_participation_id: participationId,
            p_reason: input.data.reason ?? null,
            p_status: input.data.status,
            p_until: input.data.until,
          }),
          sellerListingSchema,
        );
      }
    }

    const pinRoute = route.match(
      /^\/locations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/pin-correction$/iu,
    );
    if (request.method === "POST" && pinRoute) {
      operation = "location.pin_correct";
      const input = pinCorrectionRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Give a reason and a point.",
          400,
          correlationId,
          origin,
        );
      }
      return sellerResult(
        await admin.rpc("correct_location_pin_command", {
          p_actor_id: actorId,
          p_authenticated_at: actor.authenticatedAt,
          p_correlation_id: correlationId,
          p_latitude: input.data.latitude,
          p_location_id: pinRoute[1],
          p_longitude: input.data.longitude,
          p_reason: input.data.reason,
        }),
        eventSellersSchema,
      );
    }

    const participationRoute = route.match(
      /^\/participations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(withdraw|decision|address)$/iu,
    );
    if (request.method === "POST" && participationRoute) {
      const [, participationId, action] = participationRoute;
      const body = await requestBody(request);
      if (action === "withdraw") {
        operation = "seller.withdraw";
        const input = participationVersionRequestSchema.safeParse(body);
        if (!input.success) {
          status = "denied";
          return apiError("invalid_request", "Reload and try again.", 400, correlationId, origin);
        }
        return sellerResult(
          await admin.rpc("withdraw_participation_command", {
            p_actor_id: actorId,
            p_correlation_id: correlationId,
            p_expected_version: input.data.expectedVersion,
            p_participation_id: participationId,
          }),
          sellerParticipationSchema,
        );
      }
      if (action === "address") {
        operation = "seller.address_change";
        const input = changeParticipationAddressRequestSchema.safeParse(body);
        if (!input.success) {
          status = "denied";
          return apiError(
            "invalid_request",
            "Check the address fields.",
            400,
            correlationId,
            origin,
          );
        }
        return sellerResult(
          await admin.rpc("change_participation_address_command", {
            p_actor_id: actorId,
            p_address_line: input.data.addressLine,
            p_correlation_id: correlationId,
            p_expected_version: input.data.expectedVersion,
            p_latitude: input.data.latitude,
            p_locality: input.data.locality,
            p_longitude: input.data.longitude,
            p_participation_id: participationId,
            p_placement: input.data.placement,
            p_postal_code: input.data.postalCode,
            p_right_to_use_attested: input.data.rightToUseAttested,
            p_shares_entrance: input.data.sharesEntrance,
          }),
          sellerParticipationSchema,
        );
      }
      operation = "seller.decide";
      const input = decideSellerRequestSchema.safeParse(body);
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "That decision is not possible.",
          400,
          correlationId,
          origin,
        );
      }
      return sellerResult(
        await admin.rpc("decide_seller_participation_command", {
          p_actor_id: actorId,
          p_correlation_id: correlationId,
          p_decision: input.data.decision,
          p_expected_version: input.data.expectedVersion,
          p_participation_id: participationId,
          p_reason: input.data.reason ?? null,
        }),
        sellerParticipationSchema,
      );
    }

    const detailsRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/details$/iu,
    );
    if (request.method === "PUT" && detailsRoute) {
      operation = "event.details_update";
      const input = updateDraftEventDetailsRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Check the event fields.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("update_draft_event_details_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_description: input.data.description,
        p_ends_at: input.data.endsAt,
        p_event_id: detailsRoute[1],
        p_expected_version: input.data.expectedVersion,
        p_starts_at: input.data.startsAt,
        p_timezone: input.data.timezone,
        p_title: input.data.title,
      });
      if (error) {
        const mapped = new Map<string, [string, string, number]>([
          ["Actor cannot edit this event", ["forbidden", "You cannot edit this event.", 403]],
          [
            "Only draft event details can be edited directly",
            ["invalid_state", "Only drafts can be edited here.", 409],
          ],
          ["Event version conflict", ["version_conflict", "The event changed. Reload.", 409]],
          ["Event title is required", ["invalid_request", "Check the event fields.", 400]],
          ["Event description is too long", ["invalid_request", "Check the event fields.", 400]],
          ["Unsupported event timezone", ["invalid_request", "Check the event fields.", 400]],
          [
            "Event end must be after its start",
            ["invalid_request", "Check the event fields.", 400],
          ],
        ]).get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = eventDetailsResultSchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const duplicateRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/duplicate$/iu,
    );
    if (request.method === "POST" && duplicateRoute) {
      operation = "event.duplicate";
      const input = duplicateEventRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError("invalid_request", "Check the event fields.", 400, correlationId, origin);
      }
      const { data, error } = await admin.rpc("duplicate_event_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_ends_at: input.data.endsAt,
        p_organizer_profile_id: input.data.organizerProfileId,
        p_source_event_id: duplicateRoute[1],
        p_starts_at: input.data.startsAt,
        p_title: input.data.title,
      });
      if (error) {
        const mapped = new Map<string, [string, string, number]>([
          ["Actor cannot duplicate this event", ["forbidden", "You cannot copy this event.", 403]],
          [
            "Actor is not an organizer manager",
            ["organizer_required", "Choose an organizer you manage.", 403],
          ],
          ["Event title is required", ["invalid_request", "Check the event fields.", 400]],
          [
            "Event end must be after its start",
            ["invalid_request", "Check the event fields.", 400],
          ],
        ]).get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }
      const parsed = commandResourceResponseSchema.safeParse({ id: data, schemaVersion: "1.0" });
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 201, correlationId, origin);
    }

    const visibilityRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/visibility$/iu,
    );
    if (request.method === "PUT" && visibilityRoute) {
      operation = "event.visibility_update";
      const input = updateDraftEventVisibilityRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Choose a supported event visibility.",
          400,
          correlationId,
          origin,
        );
      }

      const { data, error } = await admin.rpc("update_draft_event_visibility_command", {
        p_actor_id: actorId,
        p_correlation_id: correlationId,
        p_event_id: visibilityRoute[1],
        p_expected_version: input.data.expectedVersion,
        p_visibility: input.data.visibility,
      });

      if (error) {
        const knownError = new Map<string, [string, string, number]>([
          [
            "Actor cannot manage event visibility",
            ["forbidden", "You cannot change this event's visibility.", 403],
          ],
          [
            "Only draft event visibility can be edited directly",
            ["invalid_state", "Only draft event visibility can be edited here.", 409],
          ],
          [
            "Event version conflict",
            ["version_conflict", "The event changed. Reload it and try again.", 409],
          ],
          [
            "Unsupported event visibility",
            ["invalid_request", "Choose a supported event visibility.", 400],
          ],
        ]);
        const mapped = knownError.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }

      const parsed = eventControlSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const boundaryRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/boundary$/iu,
    );
    if (request.method === "PUT" && boundaryRoute) {
      operation = "event.boundary_save";
      const input = saveEventBoundaryRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Check the boundary fields.",
          400,
          correlationId,
          origin,
        );
      }

      const closedRing = [...input.data.ring, input.data.ring[0]];
      const { data, error } = await admin.rpc("upsert_draft_event_boundary_command", {
        p_actor_id: actorId,
        p_boundary_geojson: { coordinates: [closedRing], type: "Polygon" },
        p_correlation_id: correlationId,
        p_display_label: input.data.displayLabel,
        p_event_id: boundaryRoute[1],
        p_expected_version: input.data.expectedVersion,
      });

      if (error) {
        const knownError = new Map<string, [string, string, number]>([
          [
            "Actor cannot manage event boundary",
            ["forbidden", "You cannot edit this event boundary.", 403],
          ],
          [
            "Event boundary version conflict",
            ["version_conflict", "The boundary changed. Reload it and try again.", 409],
          ],
          [
            "Only draft event boundaries can be edited directly",
            ["invalid_state", "Only draft event boundaries can be edited here.", 409],
          ],
          ["Invalid event boundary", ["invalid_boundary", "Draw a valid boundary.", 400]],
          [
            "Event boundary exceeds maximum area",
            ["boundary_too_large", "The boundary may cover at most 25 km².", 400],
          ],
          [
            "Event boundary exceeds maximum span",
            ["boundary_too_wide", "The boundary may span at most 10 km.", 400],
          ],
        ]);
        const mapped = knownError.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }

      const parsed = eventBoundarySummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    const registrationRoute = route.match(
      /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/registration$/iu,
    );
    if (request.method === "PUT" && registrationRoute) {
      operation = "event.registration_save";
      const input = saveEventRegistrationRequestSchema.safeParse(await requestBody(request));
      if (!input.success) {
        status = "denied";
        return apiError(
          "invalid_request",
          "Check the registration window.",
          400,
          correlationId,
          origin,
        );
      }

      const { data, error } = await admin.rpc("upsert_draft_event_registration_command", {
        p_actor_id: actorId,
        p_allow_during_event: input.data.allowDuringEvent,
        p_closes_at: input.data.closesAt,
        p_correlation_id: correlationId,
        p_event_id: registrationRoute[1],
        p_expected_version: input.data.expectedVersion,
        p_opens_at: input.data.opensAt,
      });

      if (error) {
        const knownError = new Map<string, [string, string, number]>([
          [
            "Actor cannot manage event registration",
            ["forbidden", "You cannot edit registration for this event.", 403],
          ],
          [
            "Event registration version conflict",
            ["version_conflict", "The registration window changed. Reload and try again.", 409],
          ],
          [
            "Only draft event registration can be edited directly",
            ["invalid_state", "Only draft event registration can be edited here.", 409],
          ],
          [
            "Registration close must be after registration open",
            ["invalid_registration", "Registration must close after it opens.", 400],
          ],
          [
            "Registration cannot close after event start without active-event opt-in",
            [
              "active_event_opt_in_required",
              "Confirm that registration may remain open during the event.",
              400,
            ],
          ],
          [
            "Registration cannot close after event end",
            ["invalid_registration", "Registration cannot remain open after the event ends.", 400],
          ],
          [
            "Event schedule is required",
            ["invalid_registration", "Add the event schedule before editing registration.", 400],
          ],
        ]);
        const mapped = knownError.get(error.message);
        if (mapped) {
          status = "denied";
          return apiError(mapped[0], mapped[1], mapped[2], correlationId, origin);
        }
        throw error;
      }

      const parsed = eventRegistrationSummarySchema.safeParse(data);
      if (!parsed.success) throw new Error("invalid_internal_response");
      status = "succeeded";
      return json(parsed.data, 200, correlationId, origin);
    }

    operation = "api.not_found";
    status = "denied";
    return apiError(
      "not_found",
      "The requested operation does not exist.",
      404,
      correlationId,
      origin,
    );
  } catch (error) {
    const code =
      error instanceof Error && error.message === "request_too_large"
        ? "request_too_large"
        : "internal_error";
    const responseStatus = code === "request_too_large" ? 413 : 500;
    return apiError(
      code,
      responseStatus === 413
        ? "The request is too large."
        : "The operation could not be completed.",
      responseStatus,
      correlationId,
      origin,
    );
  } finally {
    console.log(
      JSON.stringify({
        correlationId,
        deploymentRevision: Deno.env.get("DENO_DEPLOYMENT_ID") ?? "local",
        durationMs: Math.round(performance.now() - startedAt),
        generatedAt: new Date().toISOString(),
        operation,
        schemaVersion: "1.0",
        status,
      }),
    );
  }
});
