import { createClient } from "@supabase/supabase-js";
import { createBrowserSessionGateway } from "./browser-sessions.ts";
import { sessionFromVerifiedAccessToken } from "../../../packages/domain/src/auth-session.ts";
import {
  acceptEventTeamInviteRequestSchema,
  accountProfileSchema,
  accountRecoveryClaimSchema,
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
  readonly authenticatedAt: string | null;
  readonly id: string;
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
  return { authenticatedAt: session.authenticatedAt, id: data.user.id };
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
      // Explicit fail-closed boundary: remote delivery and Auth completion are not ready.
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
      if (request.method !== "POST" || route.endsWith("/complete")) {
        status = "denied";
        return apiError(
          "recovery_unavailable",
          "Account email changes are not enabled.",
          503,
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
        p_recovery_code: input.data.recoveryCode,
        p_verification_token: verificationToken,
      });
      if (error) {
        status = "denied";
        const pending = error.message === "Recovery claim already pending";
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
      /^\/account-recovery\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(verify)$/iu,
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
    }

    const actor = await authenticatedActor(request);
    if (!actor) {
      operation = "api.authentication_denied";
      status = "denied";
      return apiError("unauthorized", "Authentication is required.", 401, correlationId, origin);
    }
    const actorId = actor.id;

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
