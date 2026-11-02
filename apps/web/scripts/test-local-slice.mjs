import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }),
);

const apiUrl = status.API_URL;
const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const serviceRoleKey = status.SERVICE_ROLE_KEY;
if (!apiUrl || !publicKey || !serviceRoleKey) {
  throw new Error("The local Supabase stack did not return its required configuration.");
}

const admin = createClient(apiUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const browser = createClient(apiUrl, publicKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const runId = randomUUID();
const email = `milestone1-${runId}@example.invalid`;
const inviteeEmail = `milestone1-helper-${runId}@example.invalid`;
const password = `Local-test-${runId}`;
let accountId;
let inviteeAccountId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function bff(path, accessToken, init = {}) {
  const response = await fetch(`${apiUrl}/functions/v1/api-v1${path}`, {
    ...init,
    headers: {
      apikey: publicKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      origin: "http://127.0.0.1:5173",
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`The local BFF returned ${response.status} (${body.code ?? "unknown"}).`);
  }
  return body;
}

try {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (createError) throw createError;
  accountId = created.user.id;

  const { data: createdInvitee, error: createInviteeError } = await admin.auth.admin.createUser({
    email: inviteeEmail,
    email_confirm: true,
    password,
  });
  if (createInviteeError) throw createInviteeError;
  inviteeAccountId = createdInvitee.user.id;

  const { data: signedIn, error: signInError } = await browser.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;
  const accessToken = signedIn.session?.access_token;
  assert(accessToken, "The synthetic account did not receive an access token.");

  const initial = await bff("/dashboard", accessToken);
  assert(initial.profile.accountId === accountId, "The BFF returned the wrong account profile.");
  assert(initial.organizers.length === 0, "The synthetic account should start without organizers.");

  const profile = await bff("/profile", accessToken, {
    body: JSON.stringify({ displayName: "Synthetic Organizer", preferredLocale: "en" }),
    method: "PUT",
  });
  assert(profile.displayName === "Synthetic Organizer", "The profile update did not round-trip.");

  const initialRecovery = await bff("/account/recovery-code", accessToken);
  assert(initialRecovery.version === 0, "The account should begin without a recovery code.");
  const recovery = await bff("/account/recovery-code", accessToken, {
    body: JSON.stringify({ expectedVersion: 0 }),
    method: "POST",
  });
  assert(
    /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){4}$/u.test(recovery.code),
    "The BFF did not return a valid one-time recovery code.",
  );
  const recoveryStatus = await bff("/account/recovery-code", accessToken);
  assert(recoveryStatus.active, "The enrolled recovery code is not active.");
  assert(!("code" in recoveryStatus), "The recovery-code status unexpectedly exposed the code.");

  const event = await bff("/events", accessToken, {
    body: JSON.stringify({
      description: "Synthetic local-only verification data.",
      endsAt: "2026-09-08T15:00:00+02:00",
      organizerProfileId: null,
      publicOrganizerName: "Synthetic Organizer",
      startsAt: "2026-09-08T10:00:00+02:00",
      timezone: "Europe/Stockholm",
      title: "Synthetic neighbourhood walk",
      visibility: "unlisted",
    }),
    method: "POST",
  });

  const visibility = await bff(`/events/${event.id}/visibility`, accessToken, {
    body: JSON.stringify({ expectedVersion: 1, visibility: "public" }),
    method: "PUT",
  });
  assert(visibility.version === 2, "The visibility update did not increment event version.");
  assert(visibility.visibility === "public", "The visibility update did not round-trip.");

  await bff(`/events/${event.id}/boundary`, accessToken, {
    body: JSON.stringify({
      displayLabel: "Synthetic test area",
      expectedVersion: null,
      ring: [
        [18, 59],
        [18.01, 59],
        [18.01, 59.01],
      ],
    }),
    method: "PUT",
  });
  await bff(`/events/${event.id}/registration`, accessToken, {
    body: JSON.stringify({
      allowDuringEvent: false,
      closesAt: "2026-09-08T09:15:00+02:00",
      expectedVersion: 1,
      opensAt: "2026-09-07T08:00:00+02:00",
    }),
    method: "PUT",
  });

  const completed = await bff("/dashboard", accessToken);
  assert(completed.organizers.length === 1, "The organizer did not appear on the dashboard.");
  assert(
    completed.organizers[0].organizerType === "individual",
    "The first-event flow did not create an individual organizer.",
  );
  assert(completed.events.length === 1, "The draft event did not appear on the dashboard.");
  assert(completed.events[0].version === 2, "The event version did not round-trip.");
  assert(
    completed.events[0].intervals.length === 1,
    "The draft event did not include its opening interval.",
  );
  assert(completed.events[0].boundary?.version === 1, "The boundary did not round-trip.");
  assert(
    completed.events[0].registration?.version === 2,
    "The registration window did not round-trip.",
  );

  const readinessBeforeAttestation = await bff(
    `/events/${event.id}/publication-readiness`,
    accessToken,
  );
  assert(
    readinessBeforeAttestation.blockers.includes("publication_attestation_missing"),
    "Publication readiness did not require the owner attestation.",
  );
  const readinessAfterAttestation = await bff(
    `/events/${event.id}/publication-attestation`,
    accessToken,
    {
      body: JSON.stringify({
        expectedBoundaryVersion: 1,
        expectedEventVersion: 2,
        expectedRegistrationVersion: 2,
        locationAuthorityConfirmed: true,
        visibilityUnderstood: true,
      }),
      method: "POST",
    },
  );
  assert(
    !readinessAfterAttestation.blockers.includes("publication_attestation_missing"),
    "The current publication attestation did not clear its blocker.",
  );
  assert(
    readinessAfterAttestation.blockers.includes("routing_not_ready") &&
      !readinessAfterAttestation.blockers.includes("public_delivery_not_ready"),
    "Publication readiness did not remain fail-closed for the missing walking routes.",
  );

  const invitedTeam = await bff(`/events/${event.id}/team/invites`, accessToken, {
    body: JSON.stringify({
      email: inviteeEmail,
      expectedTeamVersion: 1,
      role: "co_host",
    }),
    method: "POST",
  });
  assert(invitedTeam.teamVersion === 2, "The team invitation did not advance its version.");
  assert(invitedTeam.pendingInvites.length === 1, "The pending invitation was not returned.");

  const inviteeBrowser = createClient(apiUrl, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: inviteeSignedIn, error: inviteeSignInError } =
    await inviteeBrowser.auth.signInWithPassword({ email: inviteeEmail, password });
  if (inviteeSignInError) throw inviteeSignInError;
  const inviteeAccessToken = inviteeSignedIn.session?.access_token;
  assert(inviteeAccessToken, "The synthetic invitee did not receive an access token.");

  const incomingInvites = await bff("/team-invites", inviteeAccessToken);
  assert(incomingInvites.length === 1, "The invited account did not see its invitation.");
  const acceptedTeam = await bff(
    `/team-invites/${incomingInvites[0].id}/accept`,
    inviteeAccessToken,
    {
      body: JSON.stringify({ displayName: "Synthetic Helper" }),
      method: "POST",
    },
  );
  assert(acceptedTeam.teamVersion === 3, "Accepting the invitation did not advance its version.");
  assert(acceptedTeam.members.length === 2, "Invitation acceptance did not create membership.");

  const ownerTeam = await bff(`/events/${event.id}/team`, accessToken);
  const helper = ownerTeam.members.find((member) => member.displayName === "Synthetic Helper");
  assert(helper?.role === "co_host", "The invited co-host did not appear in the owner team view.");

  const organizerProfileId = completed.organizers[0].id;
  const sharedOrganizer = await bff("/organizers", accessToken, {
    body: JSON.stringify({
      displayName: "Synthetic Shared Organizer",
      locality: "",
      organizerType: "informal_group",
      website: "",
    }),
    method: "POST",
  });
  const invitedOrganizerTeam = await bff(
    `/organizers/${sharedOrganizer.id}/team/invites`,
    accessToken,
    {
      body: JSON.stringify({ email: inviteeEmail, expectedTeamVersion: 1 }),
      method: "POST",
    },
  );
  assert(
    invitedOrganizerTeam.pendingInvites.length === 1,
    "The organizer manager invitation was not returned.",
  );
  const incomingOrganizerInvites = await bff("/organizer-invites", inviteeAccessToken);
  assert(
    incomingOrganizerInvites.length === 1,
    "The invited account did not see its organizer manager invitation.",
  );
  const acceptedOrganizerTeam = await bff(
    `/organizer-invites/${incomingOrganizerInvites[0].id}/accept`,
    inviteeAccessToken,
    {
      body: JSON.stringify({ displayName: "Synthetic Helper" }),
      method: "POST",
    },
  );
  assert(
    acceptedOrganizerTeam.members.some((member) => member.role === "manager"),
    "Accepting the organizer invitation did not create a manager membership.",
  );

  const recipientOrganizer = await bff("/organizers", inviteeAccessToken, {
    body: JSON.stringify({
      displayName: "Synthetic Helper Organizer",
      locality: "",
      organizerType: "individual",
      website: "",
    }),
    method: "POST",
  });

  const successorTeam = await bff(`/events/${event.id}/team/emergency-successor`, accessToken, {
    body: JSON.stringify({
      expectedTeamVersion: 3,
      successorMembershipId: helper.id,
      targetOrganizerProfileId: recipientOrganizer.id,
    }),
    method: "PUT",
  });
  assert(
    successorTeam.emergencySuccessor?.successorMembershipId === helper.id,
    "The eligible co-host was not saved as emergency successor.",
  );

  const pendingEmergencyClaim = await bff(
    `/events/${event.id}/team/emergency-successor-claims`,
    inviteeAccessToken,
    {
      body: JSON.stringify({ expectedTeamVersion: 4 }),
      method: "POST",
    },
  );
  assert(
    pendingEmergencyClaim.pendingEmergencyClaim?.successorMembershipId === helper.id,
    "The designated successor could not start an emergency claim.",
  );
  const claimId = pendingEmergencyClaim.pendingEmergencyClaim.id;
  const matureTime = new Date();
  const { error: matureClaimError } = await admin
    .from("event_emergency_successor_claims")
    .update({
      expires_at: new Date(matureTime.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      initiated_at: new Date(matureTime.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      ready_at: new Date(matureTime.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq("id", claimId);
  if (matureClaimError) throw matureClaimError;
  const acceptedTransfer = await bff(
    `/events/${event.id}/team/emergency-successor-claims/${claimId}/complete`,
    inviteeAccessToken,
    {
      body: JSON.stringify({ expectedTeamVersion: 5 }),
      method: "POST",
    },
  );
  assert(
    acceptedTransfer.members.find((member) => member.id === helper.id)?.role === "owner",
    "The intended co-host did not become owner.",
  );

  const previousOwner = acceptedTransfer.members.find(
    (member) => member.displayName === "Synthetic Organizer",
  );
  assert(previousOwner?.role === "co_host", "The previous owner did not become a co-host.");
  const transferBack = await bff(
    `/events/${event.id}/team/ownership-transfers`,
    inviteeAccessToken,
    {
      body: JSON.stringify({
        expectedTeamVersion: 6,
        targetOrganizerProfileId: organizerProfileId,
        toMembershipId: previousOwner.id,
      }),
      method: "POST",
    },
  );
  const restoredTeam = await bff(
    `/events/${event.id}/team/ownership-transfers/${transferBack.pendingTransfer.id}/accept`,
    accessToken,
    {
      body: JSON.stringify({ expectedTeamVersion: 7 }),
      method: "POST",
    },
  );
  assert(
    restoredTeam.members.find((member) => member.id === previousOwner.id)?.role === "owner",
    "The original owner was not restored after explicit acceptance.",
  );

  const moderatedTeam = await bff(`/events/${event.id}/team/members/${helper.id}`, accessToken, {
    body: JSON.stringify({ expectedTeamVersion: 8, role: "moderator" }),
    method: "PUT",
  });
  assert(
    moderatedTeam.members.find((member) => member.id === helper.id)?.role === "moderator",
    "The owner could not change the helper role.",
  );
  const ownerOnlyTeam = await bff(`/events/${event.id}/team/members/${helper.id}`, accessToken, {
    body: JSON.stringify({ expectedTeamVersion: 9 }),
    method: "DELETE",
  });
  assert(ownerOnlyTeam.members.length === 1, "The owner could not remove the helper.");

  const { error: directReadError } = await browser.from("profiles").select("account_id");
  assert(directReadError, "An authenticated browser unexpectedly read a protected table directly.");
  const { error: directBoundaryReadError } = await browser
    .from("event_boundaries")
    .select("event_id");
  assert(
    directBoundaryReadError,
    "An authenticated browser unexpectedly read event boundaries directly.",
  );
  const { error: directRegistrationReadError } = await browser
    .from("event_registration_settings")
    .select("event_id");
  assert(
    directRegistrationReadError,
    "An authenticated browser unexpectedly read registration settings directly.",
  );
  const { error: directInviteReadError } = await browser.from("event_invites").select("id");
  assert(
    directInviteReadError,
    "An authenticated browser unexpectedly read invitation emails directly.",
  );
  const { error: directTransferReadError } = await browser
    .from("event_ownership_transfers")
    .select("id");
  assert(
    directTransferReadError,
    "An authenticated browser unexpectedly read ownership transfers directly.",
  );
  const { error: directOrganizerInviteReadError } = await browser
    .from("organizer_profile_invites")
    .select("id");
  assert(
    directOrganizerInviteReadError,
    "An authenticated browser unexpectedly read organizer invitation emails directly.",
  );
  const { error: directSuccessorReadError } = await browser
    .from("event_emergency_successors")
    .select("event_id");
  assert(
    directSuccessorReadError,
    "An authenticated browser unexpectedly read emergency successors directly.",
  );
  const { error: directEmergencyClaimReadError } = await browser
    .from("event_emergency_successor_claims")
    .select("id");
  assert(
    directEmergencyClaimReadError,
    "An authenticated browser unexpectedly read emergency successor claims directly.",
  );
  const { error: directNotificationReadError } = await browser
    .schema("app_private")
    .from("notification_jobs")
    .select("id");
  assert(
    directNotificationReadError,
    "An authenticated browser unexpectedly read notification jobs directly.",
  );
  const { error: directAttestationReadError } = await browser
    .from("event_publication_attestations")
    .select("event_id");
  assert(
    directAttestationReadError,
    "An authenticated browser unexpectedly read publication attestations directly.",
  );

  await bff(`/events/${event.id}`, accessToken, {
    body: JSON.stringify({
      confirmTitle: "Synthetic neighbourhood walk",
      expectedVersion: 4,
    }),
    method: "DELETE",
  });
  const afterDelete = await bff("/dashboard", accessToken);
  assert(afterDelete.events.length === 0, "The confirmed draft deletion did not round-trip.");

  console.log(
    "Local vertical slice passed: auth, recovery code, publication readiness, successor designation and delayed claim, event and organizer invitations, ownership transfer, deletion, dashboard, and direct-table denial.",
  );
} finally {
  if (accountId) {
    await admin.from("events").delete().eq("created_by_account_id", accountId);
    await admin.from("organizer_profiles").delete().eq("created_by_account_id", accountId);
    await admin.auth.admin.deleteUser(accountId);
  }
  if (inviteeAccountId) {
    await admin.from("organizer_profiles").delete().eq("created_by_account_id", inviteeAccountId);
    await admin.auth.admin.deleteUser(inviteeAccountId);
  }
}
