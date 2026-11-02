import { createClient } from "@supabase/supabase-js";
import { createBrowserSessionGateway } from "./browser-sessions.ts";
import { sessionFromVerifiedAccessToken } from "../../../packages/domain/src/auth-session.ts";
import { normalizeOrganizationNumber } from "../../../packages/domain/src/organization-number.ts";
import {
  acceptEventTeamInviteRequestSchema,
  accountProfileSchema,
  accountDeletionStatusSchema,
  adminElevationRequestSchema,
  decideOrganizerVerificationSchema,
  organizerVerificationQueueSchema,
  organizerVerificationStatusSchema,
  requestOrganizerVerificationSchema,
  cancelEventRequestSchema,
  eventLifecycleResultSchema,
  publishEventRequestSchema,
  adminStatusSchema,
  decideFirstEventReviewSchema,
  firstEventReviewQueueSchema,
  firstEventReviewStatusSchema,
  requestFirstEventReviewSchema,
  mfaStatusSchema,
  totpEnrollmentSchema,
  accountRecoveryClaimSchema,
  accountRecoveryCompletionSchema,
  accountRecoveryStatusSchema,
  accountRecoveryTokenRequestSchema,
  attestEventPublicationRequestSchema,
  commandResourceResponseSchema,
  createDraftEventRequestSchema,
  createOrganizerProfileRequestSchema,
  deleteDraftEventRequestSchema,
  enrollRecoveryCodeRequestSchema,
  eventBoundarySummarySchema,
  eventControlSummarySchema,
  eventPublicationReadinessSchema,
  eventRegistrationSummarySchema,
  eventTeamSummarySchema,
  eventTeamVersionRequestSchema,
  identityDashboardSchema,
  incomingEventTeamInvitesSchema,
  incomingOrganizerInvitesSchema,
  initiateAccountRecoveryRequestSchema,
  requestAccountDeletionRequestSchema,
  initiateAccountRecoveryResponseSchema,
  initiateEventOwnershipTransferRequestSchema,
  inviteEventTeamMemberRequestSchema,
  inviteOrganizerManagerRequestSchema,
  organizerTeamSummarySchema,
  readinessResponseSchema,
  recoveryCodeEnrollmentResponseSchema,
  saveEventBoundaryRequestSchema,
  saveEventRegistrationRequestSchema,
  setEmergencySuccessorRequestSchema,
  updateDraftEventVisibilityRequestSchema,
  updateEventTeamMemberRoleRequestSchema,
  updateProfileRequestSchema,
} from "../../../packages/contracts/src/schemas.ts";

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
