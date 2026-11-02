import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const localAuthEnabled = process.env.PROMENADIS_LOCAL_AUTH_E2E === "1";
test.skip(!localAuthEnabled, "Run with pnpm test:e2e:local-auth against local Supabase.");

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const localStatus = localAuthEnabled
  ? (JSON.parse(
      execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }),
    ) as Record<string, string>)
  : null;
const admin = localStatus
  ? createClient(localStatus.API_URL, localStatus.SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

async function latestMessage(request: APIRequestContext, email: string) {
  let messageId: string | undefined;
  await expect
    .poll(async () => {
      const response = await request.get("http://127.0.0.1:54324/api/v1/messages");
      const body = (await response.json()) as {
        messages: Array<{ ID: string; To: Array<{ Address: string }> }>;
      };
      messageId = body.messages.find((message) =>
        message.To.some((recipient) => recipient.Address === email),
      )?.ID;
      return messageId;
    })
    .toBeTruthy();

  const response = await request.get(`http://127.0.0.1:54324/api/v1/message/${messageId}`);
  return (await response.json()) as { HTML: string; Text: string };
}

// Local fixture control only: ages a synthetic claim and marks its notices
// accepted so the full 24-hour flow can run without waiting.
function localSql(input: string) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_promenadis",
      "psql",
      "-X",
      "-Atq",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 10_000 },
  ).trim();
}

// RFC 6238 TOTP for synthetic factors only (SHA-1, 30 s, 6 digits).
function totp(secret: string, offsetSteps = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.replace(/=+$/u, "")) {
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/gu)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function deleteSyntheticAccount(email: string) {
  if (!admin) return;
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = data.users.find((candidate) => candidate.email === email);
  if (user) {
    await admin.from("events").delete().eq("created_by_account_id", user.id);
    await admin.from("organizer_profiles").delete().eq("created_by_account_id", user.id);
    await admin.auth.admin.deleteUser(user.id);
  }
}

test("recovery requires the emailed token, explicit confirmation and the full wait", async ({
  page,
  request,
}) => {
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const email = `recovery-${randomUUID()}@example.invalid`;
  const newEmail = `replacement-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const client = createClient(
    localStatus.API_URL,
    localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (createError) throw createError;
  const accountId = created.user.id;
  try {
    const { data: signedIn, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const headers = {
      apikey: localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY,
      authorization: `Bearer ${signedIn.session?.access_token}`,
      origin: "http://127.0.0.1:5173",
    };
    const base = `${localStatus.API_URL}/functions/v1/api-v1`;
    const event = await request.post(`${base}/events`, {
      headers,
      data: {
        description: "Synthetic recovery fixture",
        endsAt: "2031-09-09T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic recovery owner",
        startsAt: "2031-09-09T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic recovery walk",
        visibility: "unlisted",
      },
    });
    expect(event.status()).toBe(201);
    const enrollment = await request.post(`${base}/account/recovery-code`, {
      headers,
      data: { expectedVersion: 0 },
    });
    expect(enrollment.ok()).toBe(true);
    const recoveryCode = (await enrollment.json()).code as string;

    await page.goto("/recover-account");
    await page.getByLabel("Nuvarande e-postadress").fill(email);
    await page.getByLabel("Ny e-postadress", { exact: true }).fill(newEmail);
    await page.getByLabel("Återställningskod", { exact: true }).fill(recoveryCode);
    const startedPromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/account-recovery") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Starta återställning" }).click();
    const started = await startedPromise;
    expect(started.status()).toBe(201);
    expect(started.headers()["cache-control"]).toBe("no-store");
    const claim = await started.json();
    expect(claim.verificationToken).toBeUndefined();
    const message = await latestMessage(request, newEmail);
    const link = message.Text.match(/http:\/\/127\.0\.0\.1:5173\/recover-account#[^\s]+/u)?.[0];
    expect(link).toBeTruthy();
    const token = new URLSearchParams(new URL(link ?? "").hash.slice(1)).get("token");
    const denied = await request.post(`${base}/account-recovery/${claim.id}/verify`, {
      headers,
      data: { verificationToken: "y".repeat(43) },
    });
    expect(denied.status()).toBe(410);

    await page.goto(link ?? "");
    await expect(page.getByRole("button", { name: "Verifiera ny e-postadress" })).toBeVisible();
    await expect(page).toHaveURL(/\/recover-account$/u);
    let status = await (await request.get(`${base}/account/recovery-code`, { headers })).json();
    expect(status.pendingClaim.emailVerified).toBe(false);
    await page.getByRole("button", { name: "Verifiera ny e-postadress" }).click();
    await expect(page.getByText("Den nya e-postadressen är verifierad.")).toBeVisible();
    status = await (await request.get(`${base}/account/recovery-code`, { headers })).json();
    expect(status.pendingClaim.emailVerified).toBe(true);
    expect(status.active).toBe(false);
    const completion = await request.post(`${base}/account-recovery/${claim.id}/complete`, {
      headers,
      data: { verificationToken: token },
    });
    expect(completion.status()).toBe(409);
    expect((await admin.auth.admin.getUserById(accountId)).data.user?.email).toBe(email);
    const cancelled = await request.post(`${base}/account/recovery-claims/${claim.id}/cancel`, {
      headers,
    });
    expect(cancelled.status()).toBe(200);
    expect((await cancelled.json()).pendingClaim).toBeNull();
    const replay = await request.post(`${base}/account-recovery/${claim.id}/verify`, {
      headers,
      data: { verificationToken: token },
    });
    expect(replay.status()).toBe(410);
  } finally {
    await deleteSyntheticAccount(email);
  }
});

test("a ready recovery changes the sign-in email, ends old sessions and notifies the old address", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const email = `complete-${randomUUID()}@example.invalid`;
  const newEmail = `complete-new-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const client = createClient(localStatus.API_URL, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (createError) throw createError;
  const accountId = created.user.id;
  try {
    const { data: signedIn, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const headers = {
      apikey: publicKey,
      authorization: `Bearer ${signedIn.session?.access_token}`,
      origin: "http://127.0.0.1:5173",
    };
    const base = `${localStatus.API_URL}/functions/v1/api-v1`;
    const event = await request.post(`${base}/events`, {
      headers,
      data: {
        description: "Synthetic recovery completion fixture",
        endsAt: "2031-09-10T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic completion owner",
        startsAt: "2031-09-10T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic completion walk",
        visibility: "unlisted",
      },
    });
    expect(event.status()).toBe(201);
    const enrollment = await request.post(`${base}/account/recovery-code`, {
      headers,
      data: { expectedVersion: 0 },
    });
    const recoveryCode = (await enrollment.json()).code as string;
    const started = await request.post(`${base}/account-recovery`, {
      headers: { apikey: publicKey, origin: "http://127.0.0.1:5173" },
      data: { currentEmail: email, newEmail, recoveryCode },
    });
    expect(started.status()).toBe(201);
    const claim = await started.json();
    const message = await latestMessage(request, newEmail);
    const link = message.Text.match(/http:\/\/127\.0\.0\.1:5173\/recover-account#[^\s]+/u)?.[0];
    expect(link).toBeTruthy();

    await page.goto(link ?? "");
    // The page has read the token once it drops the fragment from the URL.
    await expect(page).toHaveURL(/\/recover-account$/u);
    await page.getByRole("button", { name: "Verifiera ny e-postadress" }).click();
    await expect(page.getByText("Väntetiden pågår")).toBeVisible();
    await expect(page.getByRole("button", { name: "Slutför återställning" })).toHaveCount(0);

    localSql(`update app_private.account_recovery_claims
      set initiated_at=now()-interval '2 days', email_verified_at=now()-interval '2 days'+interval '1 minute',
        ready_at=now()-interval '1 hour', expires_at=now()+interval '4 days'
      where id='${claim.id}' and account_id='${accountId}';
      update app_private.notification_jobs set completed_at=now()
      where source_id='${claim.id}' and template_key='account_recovery_started';`);

    await page.goto(link ?? "");
    await expect(page).toHaveURL(/\/recover-account$/u);
    await expect(page.getByRole("button", { name: "Verifiera ny e-postadress" })).toHaveCount(0);
    await page.getByRole("button", { name: "Slutför återställning" }).click();
    await expect(page.getByText(/Återställningen är klar/u)).toBeVisible();
    await expect(page.getByRole("link", { name: "Logga in" })).toBeVisible();

    expect((await admin.auth.admin.getUserById(accountId)).data.user?.email).toBe(newEmail);
    const stale = await request.get(`${base}/account/recovery-code`, { headers });
    expect(stale.status()).toBe(401);
    const refreshed = await client.auth.refreshSession({
      refresh_token: signedIn.session?.refresh_token ?? "",
    });
    expect(refreshed.error).not.toBeNull();
    expect((await client.auth.signInWithPassword({ email, password })).error).not.toBeNull();
    const replacement = await client.auth.signInWithPassword({ email: newEmail, password });
    expect(replacement.data.user?.id).toBe(accountId);

    try {
      execFileSync("node", ["scripts/deliver-local-security-notifications.mjs"], {
        cwd: repositoryRoot,
        stdio: "ignore",
      });
    } catch {
      // Unrelated leftover jobs may be skipped; the assertions below decide.
    }
    const notice = await latestMessage(request, email);
    expect(notice.Text).toMatch(/can no longer be used to sign in|kan inte längre användas/u);
    expect(notice.Text).not.toContain(newEmail);
    expect(localSql("select count(*) from app_private.recovery_previous_email_notices;")).toBe("0");
  } finally {
    await deleteSyntheticAccount(newEmail);
    await deleteSyntheticAccount(email);
  }
});

test("account deletion is blocked by owned events, disables the account and can be undone", async ({
  request,
}) => {
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const email = `deletion-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const client = createClient(localStatus.API_URL, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (createError) throw createError;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const signIn = async () => {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return {
      apikey: publicKey,
      authorization: `Bearer ${data.session?.access_token}`,
      origin: "http://127.0.0.1:5173",
    };
  };
  try {
    let headers = await signIn();
    const event = await request.post(`${base}/events`, {
      headers,
      data: {
        description: "Synthetic deletion fixture",
        endsAt: "2031-09-11T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic deletion owner",
        startsAt: "2031-09-11T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic deletion walk",
        visibility: "unlisted",
      },
    });
    expect(event.status()).toBe(201);
    const blocked = await request.get(`${base}/account/deletion`, { headers });
    expect((await blocked.json()).blockers[0].kind).toBe("owned_event");
    const refused = await request.post(`${base}/account/deletion`, {
      headers,
      data: { confirmationEmail: email },
    });
    expect(refused.status()).toBe(409);

    // Walk the legal lifecycle; publication itself is still gated.
    for (const state of ["published", "active", "ended"]) {
      localSql(`update public.events set state='${state}' where title='Synthetic deletion walk'
        and created_by_account_id=(select id from auth.users where email='${email}');`);
    }
    const mismatch = await request.post(`${base}/account/deletion`, {
      headers,
      data: { confirmationEmail: "someone-else@example.invalid" },
    });
    expect(mismatch.status()).toBe(400);
    const scheduled = await request.post(`${base}/account/deletion`, {
      headers,
      data: { confirmationEmail: email.toUpperCase() },
    });
    expect(scheduled.status()).toBe(200);
    expect((await scheduled.json()).pending).toBe(true);
    expect((await request.get(`${base}/dashboard`, { headers })).status()).toBe(401);

    headers = await signIn();
    const disabled = await request.get(`${base}/dashboard`, { headers });
    expect(disabled.status()).toBe(403);
    expect((await disabled.json()).code).toBe("account_deletion_pending");
    const undone = await request.post(`${base}/account/deletion/cancel`, { headers });
    expect(undone.status()).toBe(200);
    expect((await undone.json()).pending).toBe(false);
    expect((await request.get(`${base}/dashboard`, { headers })).status()).toBe(200);
  } finally {
    await deleteSyntheticAccount(email);
  }
});

test("optional TOTP gates every sign-in until the second step and can be turned off", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const email = `totp-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const newClient = () =>
    createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (createError) throw createError;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const headersFor = (token: string | undefined) => ({
    apikey: publicKey,
    authorization: `Bearer ${token}`,
    origin: "http://127.0.0.1:5173",
  });
  try {
    const owner = newClient();
    const first = await owner.auth.signInWithPassword({ email, password });
    if (first.error) throw first.error;
    let headers = headersFor(first.data.session?.access_token);
    const enrolled = await request.post(`${base}/account/mfa/totp`, { headers, data: {} });
    expect(enrolled.status()).toBe(201);
    const { factorId, secret } = await enrolled.json();
    // Unverified setup does not gate anything yet.
    expect((await request.get(`${base}/dashboard`, { headers })).status()).toBe(200);
    const confirmed = await owner.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
    expect(confirmed.error).toBeNull();
    headers = headersFor(confirmed.data?.access_token);
    expect(await (await request.get(`${base}/account/mfa`, { headers })).json()).toMatchObject({
      assuranceLevel: "aal2",
      totpEnabled: true,
    });

    // A new email sign-in is aal1: only the MFA status is reachable.
    const other = newClient();
    const second = await other.auth.signInWithPassword({ email, password });
    const aal1 = headersFor(second.data.session?.access_token);
    const gated = await request.get(`${base}/dashboard`, { headers: aal1 });
    expect(gated.status()).toBe(403);
    expect((await gated.json()).code).toBe("mfa_required");
    expect((await request.get(`${base}/account/mfa`, { headers: aal1 })).status()).toBe(200);
    expect(
      (await request.post(`${base}/account/mfa/totp/remove`, { headers: aal1, data: {} })).status(),
    ).toBe(403);

    // Cookie sign-in through the app: email code, then the TOTP step.
    await page.goto("/sign-in");
    await page.getByRole("textbox", { name: "E-postadress" }).fill(email);
    await page.getByRole("button", { name: "Skicka kod" }).click();
    const message = await latestMessage(request, email);
    const code = message.Text.match(/(?:^|[^0-9])([0-9]{6})(?:[^0-9]|$)/u)?.[1];
    await page.getByRole("textbox", { name: "Engångskod" }).fill(code ?? "");
    await page.getByRole("button", { name: "Verifiera kod" }).click();
    await expect(page).toHaveURL(/\/sign-in\?step=mfa$/u);
    await page.getByLabel("Sexsiffrig kod från appen").fill("000000");
    await page.getByRole("button", { name: "Fortsätt" }).click();
    await expect(page.getByText(/Koden stämde inte/u)).toBeVisible();
    await page.getByLabel("Sexsiffrig kod från appen").fill(totp(secret));
    await page.getByRole("button", { name: "Fortsätt" }).click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mina evenemang");

    const removed = await request.post(`${base}/account/mfa/totp/remove`, { headers, data: {} });
    expect(removed.status()).toBe(200);
    const third = await newClient().auth.signInWithPassword({ email, password });
    expect(
      (
        await request.get(`${base}/dashboard`, {
          headers: headersFor(third.data.session?.access_token),
        })
      ).status(),
    ).toBe(200);
  } finally {
    await deleteSyntheticAccount(email);
  }
});

test("first-event review needs an elevated admin with a fresh TOTP code", async ({ request }) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const ownerEmail = `review-owner-${randomUUID()}@example.invalid`;
  const adminEmail = `review-admin-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const signIn = async (email: string) => {
    const client = createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { client, token: data.session?.access_token };
  };
  const headersFor = (token: string | undefined) => ({
    apikey: publicKey,
    authorization: `Bearer ${token}`,
    origin: "http://127.0.0.1:5173",
  });
  for (const email of [ownerEmail, adminEmail]) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, password });
    if (error) throw error;
  }
  try {
    const owner = headersFor((await signIn(ownerEmail)).token);
    const created = await request.post(`${base}/events`, {
      headers: owner,
      data: {
        description: "Synthetic review fixture",
        endsAt: "2031-09-12T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic review owner",
        startsAt: "2031-09-12T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic review walk",
        visibility: "unlisted",
      },
    });
    expect(created.status()).toBe(201);
    const eventId = (await created.json()).id as string;
    await request.post(`${base}/account/recovery-code`, {
      headers: owner,
      data: { expectedVersion: 0 },
    });
    // Boundary and attestation through the same SQL commands the BFF uses.
    const ownerId = localSql(`select id from auth.users where email='${ownerEmail}';`);
    localSql(`select public.upsert_draft_event_boundary_command('${ownerId}','${eventId}',null,'Synthetic area',
        '{"type":"Polygon","coordinates":[[[18.06,59.33],[18.064,59.33],[18.064,59.333],[18.06,59.33]]]}'::jsonb,gen_random_uuid());
      select public.attest_event_publication_command('${ownerId}','${eventId}',
        (select version from public.events where id='${eventId}'),1,1,true,true,now(),gen_random_uuid());`);
    const version = Number(localSql(`select version from public.events where id='${eventId}';`));
    const requested = await request.post(`${base}/events/${eventId}/first-review`, {
      headers: owner,
      data: { expectedEventVersion: version },
    });
    expect(requested.status()).toBe(200);
    expect((await requested.json()).blockers).toContain("first_event_review_pending");

    // Admin: TOTP on, operator-granted eligibility, then a fresh code for admin mode.
    const adminSession = await signIn(adminEmail);
    const enrolled = await (
      await request.post(`${base}/account/mfa/totp`, {
        headers: headersFor(adminSession.token),
        data: {},
      })
    ).json();
    const upgraded = await adminSession.client.auth.mfa.challengeAndVerify({
      factorId: enrolled.factorId,
      code: totp(enrolled.secret),
    });
    const adminHeaders = headersFor(upgraded.data?.access_token);
    expect(
      (await (await request.get(`${base}/admin/status`, { headers: adminHeaders })).json())
        .eligible,
    ).toBe(false);
    execFileSync("node", ["scripts/grant-local-admin.mjs", adminEmail], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
    expect((await request.get(`${base}/admin/reviews`, { headers: adminHeaders })).status()).toBe(
      403,
    );
    expect(
      (
        await request.post(`${base}/admin/elevation`, {
          headers: adminHeaders,
          data: { code: "000000" },
        })
      ).status(),
    ).toBe(400);
    const elevated = await request.post(`${base}/admin/elevation`, {
      headers: adminHeaders,
      data: { code: totp(enrolled.secret) },
    });
    expect((await elevated.json()).elevated).toBe(true);
    const queue = await (
      await request.get(`${base}/admin/reviews`, { headers: adminHeaders })
    ).json();
    const item = queue.find((entry: { eventId: string }) => entry.eventId === eventId);
    expect(item).toMatchObject({ current: true, ownEvent: false, title: "Synthetic review walk" });
    const decided = await request.post(`${base}/admin/reviews/${eventId}/decision`, {
      headers: adminHeaders,
      data: {
        decision: "approved",
        expectedEventVersion: item.eventVersion,
        reason: "Synthetic check",
      },
    });
    expect(decided.status()).toBe(200);
    const readiness = await (
      await request.get(`${base}/events/${eventId}/publication-readiness`, { headers: owner })
    ).json();
    expect(readiness.blockers).not.toContain("first_event_review_pending");
    expect(readiness.blockers).not.toContain("first_event_review_required");
    const exited = await request.post(`${base}/admin/elevation/end`, {
      headers: adminHeaders,
      data: {},
    });
    expect((await exited.json()).elevated).toBe(false);
    expect((await request.get(`${base}/admin/reviews`, { headers: adminHeaders })).status()).toBe(
      403,
    );
  } finally {
    await deleteSyntheticAccount(adminEmail);
    await deleteSyntheticAccount(ownerEmail);
  }
});

test("publication stays gated while owners cancel published events and co-hosts end live ones", async ({
  request,
}) => {
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const email = `lifecycle-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (createError) throw createError;
  const client = createClient(localStatus.API_URL, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await client.auth.signInWithPassword({ email, password });
  const headers = {
    apikey: publicKey,
    authorization: `Bearer ${data.session?.access_token}`,
    origin: "http://127.0.0.1:5173",
  };
  const createEvent = async (title: string) => {
    const response = await request.post(`${base}/events`, {
      headers,
      data: {
        description: "Synthetic lifecycle fixture",
        endsAt: "2031-09-13T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic lifecycle owner",
        startsAt: "2031-09-13T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title,
        visibility: "unlisted",
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).id as string;
  };
  const version = (eventId: string) =>
    Number(localSql(`select version from public.events where id='${eventId}';`));
  try {
    const first = await createEvent("Synthetic cancel walk");
    const gated = await request.post(`${base}/events/${first}/publish`, {
      headers,
      data: { expectedEventVersion: version(first) },
    });
    expect(gated.status()).toBe(409);
    expect((await gated.json()).code).toBe("not_ready");

    // Fixture only: routing and delivery do not exist yet, so set the state directly.
    localSql(`update public.events set state='published' where id='${first}';`);
    const mismatch = await request.post(`${base}/events/${first}/cancel`, {
      headers,
      data: { confirmTitle: "Wrong", expectedEventVersion: version(first), publicReason: "Rain" },
    });
    expect(mismatch.status()).toBe(400);
    const cancelled = await request.post(`${base}/events/${first}/cancel`, {
      headers,
      data: {
        confirmTitle: "Synthetic cancel walk",
        expectedEventVersion: version(first),
        publicReason: "Storm warning",
      },
    });
    expect(await cancelled.json()).toMatchObject({ state: "cancelled" });

    const second = await createEvent("Synthetic live walk");
    localSql(`update public.events set state='published' where id='${second}';
      update public.events set state='active' where id='${second}';`);
    const refused = await request.post(`${base}/events/${second}/cancel`, {
      headers,
      data: {
        confirmTitle: "Synthetic live walk",
        expectedEventVersion: version(second),
        publicReason: "Rain",
      },
    });
    expect(refused.status()).toBe(409);
    const ended = await request.post(`${base}/events/${second}/end-early`, {
      headers,
      data: { expectedEventVersion: version(second) },
    });
    expect(await ended.json()).toMatchObject({ state: "ended" });
  } finally {
    await deleteSyntheticAccount(email);
  }
});

test("owners edit drafts and organizers, copy events, and elevated admins can cancel", async ({
  request,
}) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const ownerEmail = `edit-owner-${randomUUID()}@example.invalid`;
  const adminEmail = `edit-admin-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const signIn = async (email: string) => {
    const client = createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { client, token: data.session?.access_token };
  };
  const headersFor = (token: string | undefined) => ({
    apikey: publicKey,
    authorization: `Bearer ${token}`,
    origin: "http://127.0.0.1:5173",
  });
  for (const email of [ownerEmail, adminEmail]) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, password });
    if (error) throw error;
  }
  try {
    const owner = headersFor((await signIn(ownerEmail)).token);
    const created = await request.post(`${base}/events`, {
      headers: owner,
      data: {
        description: "Synthetic edit fixture",
        endsAt: "2031-09-14T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic edit owner",
        startsAt: "2031-09-14T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic edit walk",
        visibility: "unlisted",
      },
    });
    const eventId = (await created.json()).id as string;
    const dashboard = async () =>
      (await request.get(`${base}/dashboard`, { headers: owner })).json();
    const before = await dashboard();
    const event = before.events.find((candidate: { id: string }) => candidate.id === eventId);

    const edited = await request.put(`${base}/events/${eventId}/details`, {
      headers: owner,
      data: {
        description: "Edited description",
        endsAt: "2031-09-07T15:00:00+02:00",
        expectedVersion: event.version,
        startsAt: "2031-09-07T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic edited walk",
      },
    });
    expect(await edited.json()).toMatchObject({ registrationReset: true, state: "draft" });
    const stale = await request.put(`${base}/events/${eventId}/details`, {
      headers: owner,
      data: {
        description: "",
        endsAt: "2031-09-07T15:00:00+02:00",
        expectedVersion: event.version,
        startsAt: "2031-09-07T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Stale",
      },
    });
    expect(stale.status()).toBe(409);

    const organizer = before.organizers[0];
    const renamed = await request.put(`${base}/organizers/${organizer.id}`, {
      headers: owner,
      data: {
        displayName: "Synthetic renamed owner",
        expectedVersion: organizer.version,
        locality: "Uppsala",
        website: "",
      },
    });
    expect(await renamed.json()).toMatchObject({
      displayName: "Synthetic renamed owner",
      version: 2,
    });

    const copied = await request.post(`${base}/events/${eventId}/duplicate`, {
      headers: owner,
      data: {
        endsAt: "2032-09-07T15:00:00+02:00",
        organizerProfileId: null,
        startsAt: "2032-09-07T10:00:00+02:00",
        title: "Synthetic copied walk",
      },
    });
    expect(copied.status()).toBe(201);
    const copyId = (await copied.json()).id as string;
    const copy = (await dashboard()).events.find(
      (candidate: { id: string }) => candidate.id === copyId,
    );
    expect(copy).toMatchObject({
      description: "Edited description",
      organizerDisplayName: "Synthetic renamed owner",
      role: "owner",
      state: "draft",
    });

    // Admin: elevate with a fresh code, then cancel the published original.
    const adminSession = await signIn(adminEmail);
    const enrolled = await (
      await request.post(`${base}/account/mfa/totp`, {
        headers: headersFor(adminSession.token),
        data: {},
      })
    ).json();
    const upgraded = await adminSession.client.auth.mfa.challengeAndVerify({
      factorId: enrolled.factorId,
      code: totp(enrolled.secret),
    });
    const adminHeaders = headersFor(upgraded.data?.access_token);
    execFileSync("node", ["scripts/grant-local-admin.mjs", adminEmail], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
    expect(
      (await request.get(`${base}/admin/events/${eventId}`, { headers: adminHeaders })).status(),
    ).toBe(403);
    await request.post(`${base}/admin/elevation`, {
      headers: adminHeaders,
      data: { code: totp(enrolled.secret) },
    });
    // Fixture only: publication gates are still closed, so set the state directly.
    localSql(`update public.events set state='published' where id='${eventId}';`);
    const found = await (
      await request.get(`${base}/admin/events/${eventId}`, { headers: adminHeaders })
    ).json();
    expect(found).toMatchObject({ state: "published", title: "Synthetic edited walk" });
    const cancelled = await request.post(`${base}/admin/events/${eventId}/intervention`, {
      headers: adminHeaders,
      data: {
        action: "cancel",
        expectedEventVersion: found.version,
        internalReason: "Synthetic report",
        publicReason: "Unsafe area",
      },
    });
    expect(await cancelled.json()).toMatchObject({ state: "cancelled" });
  } finally {
    await deleteSyntheticAccount(adminEmail);
    await deleteSyntheticAccount(ownerEmail);
  }
});

test("sellers apply through the join page, fill seller places and move up from the waiting list", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const ownerEmail = `market-owner-${randomUUID()}@example.invalid`;
  const firstEmail = `market-seller-a-${randomUUID()}@example.invalid`;
  const secondEmail = `market-seller-b-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const headersFor = async (email: string) => {
    const client = createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return {
      apikey: publicKey,
      authorization: `Bearer ${data.session?.access_token}`,
      origin: "http://127.0.0.1:5173",
    };
  };
  for (const email of [ownerEmail, secondEmail]) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, password });
    if (error) throw error;
  }
  try {
    const owner = await headersFor(ownerEmail);
    const created = await request.post(`${base}/events`, {
      headers: owner,
      data: {
        description: "Synthetic market",
        endsAt: "2031-09-15T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic market owner",
        startsAt: "2031-09-15T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic seller market",
        visibility: "unlisted",
      },
    });
    const eventId = (await created.json()).id as string;
    const ownerId = localSql(`select id from auth.users where email='${ownerEmail}';`);
    localSql(`select public.upsert_draft_event_boundary_command('${ownerId}','${eventId}',null,'Synthetic area',
        '{"type":"Polygon","coordinates":[[[18.06,59.33],[18.064,59.33],[18.064,59.333],[18.06,59.333],[18.06,59.33]]]}'::jsonb,
        gen_random_uuid());
      update public.event_entitlements set seller_limit=1 where event_id='${eventId}';`);
    const eventVersion = Number(
      localSql(`select version from public.events where id='${eventId}';`),
    );
    const admission = await request.put(`${base}/events/${eventId}/admission`, {
      headers: owner,
      data: {
        admissionMode: "auto_inside",
        expectedVersion: eventVersion,
        waitlistPromotionPaused: false,
      },
    });
    expect(await admission.json()).toMatchObject({ admissionMode: "auto_inside", sellerLimit: 1 });

    // First seller: the browser join page with typed coordinates.
    await signIn(page, firstEmail);
    await page.goto(`/events/${eventId}/join`);
    await page.getByLabel("Namn som visas för besökare").fill("Syntetisk säljare");
    await page.getByLabel("Adress", { exact: true }).fill("Testgatan 1");
    await page.getByLabel("Postnummer (valfritt)").fill("113 45");
    await page.getByLabel("Latitud").fill("59.331");
    await page.getByLabel("Longitud").fill("18.062");
    await page.getByLabel(/Jag har rätt att använda/u).check();
    await page.getByRole("button", { name: "Skicka ansökan" }).click();
    await expect(page.getByText("Du har en säljplats på evenemanget.")).toBeVisible();

    // Second seller is waitlisted, then promoted when the first withdraws.
    const second = await headersFor(secondEmail);
    const applied = await request.post(`${base}/events/${eventId}/participation`, {
      headers: second,
      data: {
        addressLine: "Testgatan 2",
        displayName: "Second seller",
        latitude: 59.3315,
        locality: "",
        longitude: 18.0625,
        placement: "manual",
        postalCode: "",
        rightToUseAttested: true,
        sharesEntrance: null,
      },
    });
    expect(await applied.json()).toMatchObject({ state: "waitlisted" });
    expect(
      (await request.get(`${base}/events/${eventId}/sellers`, { headers: second })).status(),
    ).toBe(403);
    const team = await (
      await request.get(`${base}/events/${eventId}/sellers`, { headers: owner })
    ).json();
    expect(team).toMatchObject({ locationCount: 1, placesUsed: 1, sellerLimit: 1 });

    await page.getByRole("button", { name: "Dra tillbaka ansökan" }).click();
    await expect(page.getByText(/Ansökan är tillbakadragen/u)).toBeVisible();
    const mine = await (await request.get(`${base}/participations`, { headers: second })).json();
    expect(mine[0]).toMatchObject({
      eventTitle: "Synthetic seller market",
      location: null,
      state: "approved",
    });
    expect(
      localSql(`select count(*) from public.event_locations where event_id='${eventId}';`),
    ).toBe("1");
  } finally {
    await deleteSyntheticAccount(firstEmail);
    await deleteSyntheticAccount(secondEmail);
    await deleteSyntheticAccount(ownerEmail);
  }
});

test("geocoded pins, shared stops, address review and pin corrections", async ({ request }) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const emails = ["owner", "seller-a", "seller-b"].map(
    (role) => `stops-${role}-${randomUUID()}@example.invalid`,
  );
  const password = `Local-test-${randomUUID()}`;
  const headersFor = async (email: string) => {
    const client = createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return {
      apikey: publicKey,
      authorization: `Bearer ${data.session?.access_token}`,
      origin: "http://127.0.0.1:5173",
    };
  };
  for (const email of emails) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, password });
    if (error) throw error;
  }
  try {
    const [owner, sellerA, sellerB] = await Promise.all(emails.map(headersFor));
    const created = await request.post(`${base}/events`, {
      headers: owner,
      data: {
        description: "Synthetic stops",
        endsAt: "2031-09-16T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic stops owner",
        startsAt: "2031-09-16T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic stops market",
        visibility: "unlisted",
      },
    });
    const eventId = (await created.json()).id as string;
    const ownerId = localSql(`select id from auth.users where email='${emails[0]}';`);
    localSql(`select public.upsert_draft_event_boundary_command('${ownerId}','${eventId}',null,'Synthetic area',
        '{"type":"Polygon","coordinates":[[[18.06,59.33],[18.064,59.33],[18.064,59.333],[18.06,59.333],[18.06,59.33]]]}'::jsonb,
        gen_random_uuid());
      update public.events set admission_mode='auto_inside' where id='${eventId}';`);

    const lookup = await request.post(`${base}/events/${eventId}/geocode`, {
      headers: sellerA,
      data: { addressLine: "Testgatan 3", locality: "", postalCode: "" },
    });
    const point = await lookup.json();
    expect(point).toMatchObject({ found: true, latitude: 59.331 });
    const missing = await request.post(`${base}/events/${eventId}/geocode`, {
      headers: sellerA,
      data: { addressLine: "Okänd väg 1", locality: "", postalCode: "" },
    });
    expect(await missing.json()).toMatchObject({ found: false });

    const application = (headers: Record<string, string>, sharesEntrance: boolean | null) =>
      request.post(`${base}/events/${eventId}/participation`, {
        headers,
        data: {
          addressLine: "Testgatan 3",
          displayName: "Synthetic stop seller",
          latitude: point.latitude,
          locality: "",
          longitude: point.longitude,
          placement: "geocoded",
          postalCode: "",
          rightToUseAttested: true,
          sharesEntrance,
        },
      });
    const first = await (await application(sellerA, null)).json();
    expect(first).toMatchObject({ location: { placement: "geocoded" }, state: "approved" });
    const asked = await application(sellerB, null);
    expect(asked.status()).toBe(409);
    expect((await asked.json()).code).toBe("shared_entrance_question");
    const second = await (await application(sellerB, true)).json();
    expect(second.location).toMatchObject({ id: first.location.id, sellerCount: 2 });

    const moved = await request.post(`${base}/participations/${first.id}/address`, {
      headers: sellerA,
      data: {
        addressLine: "Provgatan 4",
        expectedVersion: first.version,
        latitude: 59.3322,
        locality: "",
        longitude: 18.0609,
        placement: "manual",
        postalCode: "",
        rightToUseAttested: true,
        sharesEntrance: null,
      },
    });
    const movedBody = await moved.json();
    expect(movedBody).toMatchObject({ state: "pending_address_change" });
    const team = await (
      await request.get(`${base}/events/${eventId}/sellers`, { headers: owner })
    ).json();
    expect(team).toMatchObject({ locationCount: 2, placesUsed: 2 });

    const approved = await request.post(`${base}/participations/${first.id}/decision`, {
      headers: owner,
      data: { decision: "approve", expectedVersion: movedBody.version },
    });
    expect(await approved.json()).toMatchObject({ state: "approved" });
    const tooFar = await request.post(`${base}/locations/${movedBody.location.id}/pin-correction`, {
      headers: owner,
      data: { latitude: 59.3322, longitude: 18.0619, reason: "Wrong house" },
    });
    expect((await tooFar.json()).code).toBe("correction_too_large");
    const corrected = await request.post(
      `${base}/locations/${movedBody.location.id}/pin-correction`,
      {
        headers: owner,
        data: { latitude: 59.3322, longitude: 18.0611, reason: "Pin across the street" },
      },
    );
    const sellers = (await corrected.json()).sellers as {
      id: string;
      location: { placement: string };
    }[];
    expect(sellers.find((item) => item.id === first.id)?.location.placement).toBe("corrected");
  } finally {
    for (const email of emails) await deleteSyntheticAccount(email);
  }
});

test("hosts pick categories; sellers write listings and set live status during the event", async ({
  request,
}) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const emails = ["owner", "seller"].map(
    (role) => `listing-${role}-${randomUUID()}@example.invalid`,
  );
  const password = `Local-test-${randomUUID()}`;
  const headersFor = async (email: string) => {
    const client = createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return {
      apikey: publicKey,
      authorization: `Bearer ${data.session?.access_token}`,
      origin: "http://127.0.0.1:5173",
    };
  };
  for (const email of emails) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, password });
    if (error) throw error;
  }
  try {
    const [owner, seller] = await Promise.all(emails.map(headersFor));
    const created = await request.post(`${base}/events`, {
      headers: owner,
      data: {
        description: "Synthetic listings",
        endsAt: "2031-09-17T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic listing owner",
        startsAt: "2031-09-17T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic listing market",
        visibility: "unlisted",
      },
    });
    const eventId = (await created.json()).id as string;
    const ownerId = localSql(`select id from auth.users where email='${emails[0]}';`);
    localSql(`select public.upsert_draft_event_boundary_command('${ownerId}','${eventId}',null,'Synthetic area',
        '{"type":"Polygon","coordinates":[[[18.06,59.33],[18.064,59.33],[18.064,59.333],[18.06,59.333],[18.06,59.33]]]}'::jsonb,
        gen_random_uuid());
      update public.events set admission_mode='auto_inside' where id='${eventId}';`);
    const taxonomy = await (
      await request.get(`${base}/events/${eventId}/taxonomy`, { headers: owner })
    ).json();
    expect(taxonomy.categories).toHaveLength(14);
    const books = taxonomy.categories.find((c: { key: string }) => c.key === "books_media").id;
    const saved = await request.put(`${base}/events/${eventId}/taxonomy`, {
      headers: owner,
      data: {
        enabledCategoryIds: [books],
        expectedVersion: taxonomy.version,
        suggestedTags: ["Vinyl"],
      },
    });
    expect(await saved.json()).toMatchObject({ suggestedTags: ["Vinyl"] });

    const participation = await (
      await request.post(`${base}/events/${eventId}/participation`, {
        headers: seller,
        data: {
          addressLine: "Testgatan 5",
          displayName: "Synthetic records",
          latitude: 59.331,
          locality: "",
          longitude: 18.061,
          placement: "manual",
          postalCode: "",
          rightToUseAttested: true,
          sharesEntrance: null,
        },
      })
    ).json();
    const listing = {
      accessibility: {
        elevator: null,
        setting: "outdoor",
        stairs: false,
        stepFree: true,
        strollerFriendly: null,
      },
      availability: [],
      categoryIds: [books],
      description: "Jazz and soul records",
      earlyVisibilityOptOut: true,
      expectedVersion: 0,
      items: [{ categoryId: books, name: "Blue Note LP", priceMinor: 15000, status: "available" }],
      tags: ["Vinyl", "Jazz"],
      title: "Record corner",
    };
    const badTag = await request.put(`${base}/participations/${participation.id}/listing`, {
      headers: seller,
      data: { ...listing, tags: ["Verifierad säljare"] },
    });
    expect(badTag.status()).toBe(400);
    const written = await request.put(`${base}/participations/${participation.id}/listing`, {
      headers: seller,
      data: listing,
    });
    expect(await written.json()).toMatchObject({
      earlyVisibilityOptOut: true,
      tags: ["Vinyl", "Jazz"],
      version: 1,
    });
    const teamView = await (
      await request.get(`${base}/participations/${participation.id}/listing`, { headers: owner })
    ).json();
    expect(teamView.items[0]).toMatchObject({
      currency: "SEK",
      name: "Blue Note LP",
      priceMinor: 15000,
    });

    localSql(`update public.events set state='published' where id='${eventId}';
      update public.events set state='active' where id='${eventId}';`);
    const away = await request.post(`${base}/participations/${participation.id}/live-status`, {
      headers: seller,
      data: { status: "away", until: null },
    });
    expect((await away.json()).liveStatus).toMatchObject({ status: "away" });
    const noReason = await request.post(`${base}/participations/${participation.id}/live-status`, {
      headers: owner,
      data: { status: "closed_early", until: null },
    });
    expect((await noReason.json()).code).toBe("reason_required");
  } finally {
    for (const email of emails) await deleteSyntheticAccount(email);
  }
});

test("anonymous reports quarantine one location until the team decides", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const emails = ["owner", "seller-a", "seller-b"].map(
    (role) => `report-${role}-${randomUUID()}@example.invalid`,
  );
  const password = `Local-test-${randomUUID()}`;
  const headersFor = async (email: string) => {
    const client = createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return {
      apikey: publicKey,
      authorization: `Bearer ${data.session?.access_token}`,
      origin: "http://127.0.0.1:5173",
    };
  };
  for (const email of emails) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, password });
    if (error) throw error;
  }
  localSql("delete from app_private.report_rate_buckets;");
  try {
    const [owner, sellerA, sellerB] = await Promise.all(emails.map(headersFor));
    const created = await request.post(`${base}/events`, {
      headers: owner,
      data: {
        description: "Synthetic reports",
        endsAt: "2031-09-18T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic report owner",
        startsAt: "2031-09-18T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic report market",
        visibility: "unlisted",
      },
    });
    const eventId = (await created.json()).id as string;
    const ownerId = localSql(`select id from auth.users where email='${emails[0]}';`);
    localSql(`select public.upsert_draft_event_boundary_command('${ownerId}','${eventId}',null,'Synthetic area',
        '{"type":"Polygon","coordinates":[[[18.06,59.33],[18.064,59.33],[18.064,59.333],[18.06,59.333],[18.06,59.33]]]}'::jsonb,
        gen_random_uuid());
      update public.events set admission_mode='auto_inside' where id='${eventId}';`);
    const apply = async (headers: Record<string, string>, address: string, longitude: number) =>
      (
        await request.post(`${base}/events/${eventId}/participation`, {
          headers,
          data: {
            addressLine: address,
            displayName: "Synthetic reported seller",
            latitude: 59.331,
            locality: "",
            longitude,
            placement: "manual",
            postalCode: "",
            rightToUseAttested: true,
            sharesEntrance: null,
          },
        })
      ).json();
    const reported = await apply(sellerA, "Testgatan 7", 18.0612);
    const other = await apply(sellerB, "Testgatan 8", 18.0613);

    const anonymous = { apikey: publicKey, origin: "http://127.0.0.1:5173" };
    const report = await request.post(`${base}/reports`, {
      headers: anonymous,
      data: {
        confirmsNoConsent: true,
        details: "I live here and never agreed to a stall at my door.",
        eventId,
        reason: "unauthorized_address",
        relationship: "resident",
        reporterContact: "neighbour@example.invalid",
        subjectId: reported.location.id,
        subjectType: "location",
      },
    });
    expect(report.status()).toBe(202);
    expect(await report.json()).toEqual({ received: true });

    const sellerView = await (
      await request.get(`${base}/events/${eventId}/seller-view`, { headers: sellerA })
    ).json();
    expect(sellerView.participation.location.quarantined).toBe(true);
    const otherView = await (
      await request.get(`${base}/events/${eventId}/seller-view`, { headers: sellerB })
    ).json();
    expect(otherView.participation.location.quarantined).toBe(false);

    const casesResponse = await request.get(`${base}/events/${eventId}/cases`, { headers: owner });
    const casesText = await casesResponse.text();
    expect(casesText).not.toContain("neighbour@example.invalid");
    const cases = JSON.parse(casesText);
    expect(cases[0]).toMatchObject({ quarantined: true, state: "open" });
    const dismissed = await request.post(`${base}/cases/${cases[0].id}/review`, {
      headers: owner,
      data: { decision: "dismiss", reason: "Looks fine" },
    });
    expect((await dismissed.json()).code).toBe("quarantine_needs_decision");
    const upheld = await request.post(`${base}/cases/${cases[0].id}/review`, {
      headers: owner,
      data: { decision: "uphold", reason: "Resident confirmed" },
    });
    expect((await upheld.json())[0]).toMatchObject({ outcome: "upheld", state: "closed" });
    const mine = await (await request.get(`${base}/moderation`, { headers: sellerA })).json();
    expect(mine.map((item: { action: string }) => item.action).sort()).toEqual([
      "quarantine",
      "uphold_removal",
    ]);

    const suspended = await request.post(`${base}/participations/${other.id}/moderation`, {
      headers: owner,
      data: { action: "suspend", itemId: null, reason: "Checking a complaint" },
    });
    expect(await suspended.json()).toMatchObject({ state: "suspended" });

    // The public form goes through the browser gateway without any session.
    await page.goto(`/report?event=${eventId}&type=participation&subject=${other.id}`);
    await page.getByLabel("Vad gäller det?").selectOption("harassment");
    await page.getByLabel("Beskriv vad som är fel").fill("Threatening text on the listing.");
    await page.getByRole("button", { name: "Skicka anmälan" }).click();
    await expect(page.getByText(/Anmälan är mottagen/u)).toBeVisible();
  } finally {
    for (const email of emails) await deleteSyntheticAccount(email);
  }
});

test("invited sellers, appeals to an elevated admin and platform restrictions", async ({
  request,
}) => {
  test.setTimeout(120_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const [ownerEmail, sellerEmail, adminEmail] = ["owner", "seller", "admin"].map(
    (role) => `appeal-${role}-${randomUUID()}@example.invalid`,
  );
  const password = `Local-test-${randomUUID()}`;
  const signIn = async (email: string) => {
    const client = createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { client, token: data.session?.access_token };
  };
  const headersFor = (token: string | undefined) => ({
    apikey: publicKey,
    authorization: `Bearer ${token}`,
    origin: "http://127.0.0.1:5173",
  });
  for (const email of [ownerEmail, sellerEmail, adminEmail]) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, password });
    if (error) throw error;
  }
  try {
    const owner = headersFor((await signIn(ownerEmail)).token);
    const seller = headersFor((await signIn(sellerEmail)).token);
    const created = await request.post(`${base}/events`, {
      headers: owner,
      data: {
        description: "Synthetic invitations",
        endsAt: "2031-09-19T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic invite owner",
        startsAt: "2031-09-19T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic invite market",
        visibility: "unlisted",
      },
    });
    const eventId = (await created.json()).id as string;
    const ownerId = localSql(`select id from auth.users where email='${ownerEmail}';`);
    localSql(`select public.upsert_draft_event_boundary_command('${ownerId}','${eventId}',null,'Synthetic area',
        '{"type":"Polygon","coordinates":[[[18.06,59.33],[18.064,59.33],[18.064,59.333],[18.06,59.333],[18.06,59.33]]]}'::jsonb,
        gen_random_uuid());
      update public.events set admission_mode='invite_only' where id='${eventId}';`);
    const invite = async () => {
      const invited = await request.post(`${base}/events/${eventId}/seller-invites`, {
        headers: owner,
        data: { email: sellerEmail.toUpperCase() },
      });
      expect(await invited.json()).toHaveLength(1);
      const incoming = await (
        await request.get(`${base}/seller-invites`, { headers: seller })
      ).json();
      expect(incoming[0]).toMatchObject({ eventTitle: "Synthetic invite market" });
      return (
        await request.post(`${base}/seller-invites/${incoming[0].id}/accept`, {
          headers: seller,
          data: {
            addressLine: "Testgatan 11",
            displayName: "Synthetic invited seller",
            latitude: 59.331,
            locality: "",
            longitude: 18.0615,
            placement: "manual",
            postalCode: "",
            rightToUseAttested: true,
            sharesEntrance: null,
          },
        })
      ).json();
    };
    const accepted = await invite();
    expect(accepted).toMatchObject({ state: "approved" });

    const revoked = await request.post(`${base}/participations/${accepted.id}/decision`, {
      headers: owner,
      data: { decision: "revoke", expectedVersion: accepted.version, reason: "Did not show up" },
    });
    expect(await revoked.json()).toMatchObject({ location: null, state: "revoked" });
    const decisions = await (await request.get(`${base}/moderation`, { headers: seller })).json();
    const appealed = await request.post(`${base}/moderation/${decisions[0].id}/appeal`, {
      headers: seller,
      data: { statement: "I was there all day, ask the neighbours." },
    });
    expect((await appealed.json())[0].appeal).toMatchObject({ state: "pending" });

    // Admin: TOTP, operator grant and a fresh code for admin mode.
    const adminSession = await signIn(adminEmail);
    const enrolled = await (
      await request.post(`${base}/account/mfa/totp`, {
        headers: headersFor(adminSession.token),
        data: {},
      })
    ).json();
    const upgraded = await adminSession.client.auth.mfa.challengeAndVerify({
      factorId: enrolled.factorId,
      code: totp(enrolled.secret),
    });
    const adminHeaders = headersFor(upgraded.data?.access_token);
    execFileSync("node", ["scripts/grant-local-admin.mjs", adminEmail], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
    await request.post(`${base}/admin/elevation`, {
      headers: adminHeaders,
      data: { code: totp(enrolled.secret) },
    });
    const appeals = await (
      await request.get(`${base}/admin/appeals`, { headers: adminHeaders })
    ).json();
    const mine = appeals.find(
      (item: { eventTitle: string }) => item.eventTitle === "Synthetic invite market",
    );
    expect(mine).toMatchObject({ action: "revoke", ownDecision: false });
    const reversed = await request.post(`${base}/admin/appeals/${mine.id}/decision`, {
      headers: adminHeaders,
      data: { decision: "reverse", reason: "Neighbours confirmed" },
    });
    expect(reversed.status()).toBe(200);
    const after = await (await request.get(`${base}/moderation`, { headers: seller })).json();
    expect(after[0].appeal).toMatchObject({ independent: true, state: "reversed" });
    expect(await invite()).toMatchObject({ state: "approved" });

    const found = await (
      await request.post(`${base}/admin/accounts/lookup`, {
        headers: adminHeaders,
        data: { email: sellerEmail, reason: "Repeated complaints" },
      })
    ).json();
    expect(found.restriction).toBeNull();
    const restricted = await (
      await request.post(`${base}/admin/accounts/${found.accountId}/restrict`, {
        headers: adminHeaders,
        data: { reason: "Fraud across events" },
      })
    ).json();
    const view = await (
      await request.get(`${base}/events/${eventId}/seller-view`, { headers: seller })
    ).json();
    expect(view.participation.state).toBe("suspended");
    const lifted = await request.post(
      `${base}/admin/restrictions/${restricted.restriction.id}/lift`,
      {
        headers: adminHeaders,
        data: { reason: "Resolved with the seller" },
      },
    );
    expect(await lifted.json()).toEqual({ pendingApproval: false });
  } finally {
    for (const email of [adminEmail, sellerEmail, ownerEmail]) await deleteSyntheticAccount(email);
  }
});

test("postponement asks sellers to reconfirm and seller data is erased after the grace", async ({
  request,
}) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const emails = ["owner", "seller"].map(
    (role) => `postpone-${role}-${randomUUID()}@example.invalid`,
  );
  const password = `Local-test-${randomUUID()}`;
  const headersFor = async (email: string) => {
    const client = createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return {
      apikey: publicKey,
      authorization: `Bearer ${data.session?.access_token}`,
      origin: "http://127.0.0.1:5173",
    };
  };
  for (const email of emails) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, password });
    if (error) throw error;
  }
  try {
    const [owner, seller] = await Promise.all(emails.map(headersFor));
    const start = new Date(Date.now() + 3 * 86_400_000);
    const created = await request.post(`${base}/events`, {
      headers: owner,
      data: {
        description: "Synthetic postponement",
        endsAt: new Date(start.getTime() + 5 * 3_600_000).toISOString(),
        organizerProfileId: null,
        publicOrganizerName: "Synthetic postponement owner",
        startsAt: start.toISOString(),
        timezone: "Europe/Stockholm",
        title: "Synthetic postponed market",
        visibility: "unlisted",
      },
    });
    const eventId = (await created.json()).id as string;
    const ownerId = localSql(`select id from auth.users where email='${emails[0]}';`);
    localSql(`select public.upsert_draft_event_boundary_command('${ownerId}','${eventId}',null,'Synthetic area',
        '{"type":"Polygon","coordinates":[[[18.06,59.33],[18.064,59.33],[18.064,59.333],[18.06,59.333],[18.06,59.33]]]}'::jsonb,
        gen_random_uuid());
      update public.events set admission_mode='auto_inside' where id='${eventId}';`);
    const participation = await (
      await request.post(`${base}/events/${eventId}/participation`, {
        headers: seller,
        data: {
          addressLine: "Testgatan 14",
          displayName: "Synthetic postponed seller",
          latitude: 59.331,
          locality: "",
          longitude: 18.062,
          placement: "manual",
          postalCode: "",
          rightToUseAttested: true,
          sharesEntrance: null,
        },
      })
    ).json();
    expect(participation.state).toBe("approved");
    localSql(`update public.events set state='published' where id='${eventId}';`);
    const version = () =>
      Number(localSql(`select version from public.events where id='${eventId}';`));

    const postponed = await request.post(`${base}/events/${eventId}/postpone`, {
      headers: owner,
      data: { expectedEventVersion: version(), publicReason: "Storm warning" },
    });
    expect(await postponed.json()).toMatchObject({ state: "postponed" });
    const waiting = await (
      await request.get(`${base}/events/${eventId}/seller-view`, { headers: seller })
    ).json();
    expect(waiting).toMatchObject({ registrationOpen: false, state: "postponed" });
    expect(waiting.participation.state).toBe("pending_reschedule_confirmation");

    const newStart = new Date(Date.now() + 10 * 86_400_000);
    const rescheduled = await request.post(`${base}/events/${eventId}/reschedule`, {
      headers: owner,
      data: {
        endsAt: new Date(newStart.getTime() + 5 * 3_600_000).toISOString(),
        expectedEventVersion: version(),
        startsAt: newStart.toISOString(),
      },
    });
    expect(await rescheduled.json()).toMatchObject({ state: "published" });
    const confirmed = await request.post(
      `${base}/participations/${participation.id}/reschedule-confirmation`,
      {
        headers: seller,
        data: { accept: true },
      },
    );
    expect(await confirmed.json()).toMatchObject({ state: "approved" });

    // Retention: 15 days after the end, the job erases precise seller data.
    localSql(`update public.events set state='active' where id='${eventId}';
      update public.events set state='ended' where id='${eventId}';
      update public.events set state_changed_at=now()-interval '15 days' where id='${eventId}';
      select app_private.enforce_event_retention_command();`);
    expect(
      localSql(`select count(*) from public.event_locations where event_id='${eventId}';`),
    ).toBe("0");
    const gone = await (
      await request.get(`${base}/events/${eventId}/seller-view`, { headers: seller })
    ).json();
    expect(gone.participation).toBeNull();
    expect(localSql("select (public.retention_health_command()->>'stale');")).toBe("false");
  } finally {
    for (const email of emails) await deleteSyntheticAccount(email);
  }
});

test("public and unlisted landing pages, discovery, sitemap and replaced links", async ({
  page,
  request,
}) => {
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const email = `public-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (createError) throw createError;
  const client = createClient(localStatus.API_URL, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await client.auth.signInWithPassword({ email, password });
  const headers = {
    apikey: publicKey,
    authorization: `Bearer ${data.session?.access_token}`,
    origin: "http://127.0.0.1:5173",
  };
  const marker = randomUUID().slice(0, 8);
  const createEvent = async (title: string, visibility: "public" | "unlisted") => {
    const response = await request.post(`${base}/events`, {
      headers,
      data: {
        description: `Synthetic landing fixture ${marker}`,
        endsAt: "2031-09-20T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: `Synthetic organizer ${marker}`,
        startsAt: "2031-09-20T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title,
        visibility,
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).id as string;
  };
  const link = async (eventId: string) =>
    (await (await request.get(`${base}/events/${eventId}/public-link`, { headers })).json()) as {
      publicKey: string;
      version: number;
    };
  try {
    const publicId = await createEvent(`Synthetic public walk ${marker}`, "public");
    const unlistedId = await createEvent(`Synthetic unlisted walk ${marker}`, "unlisted");
    const publicLink = await link(publicId);
    expect((await page.goto(`/e/${publicLink.publicKey}`))?.status()).toBe(404);

    // Fixture only: routing is not built yet, so publication is set directly.
    localSql(
      `update public.events set state='published' where id in ('${publicId}','${unlistedId}');`,
    );
    const landing = await page.goto(`/e/${publicLink.publicKey}`);
    expect(landing?.status()).toBe(200);
    expect(landing?.headers()["x-robots-tag"]).toBeUndefined();
    await expect(
      page.getByRole("heading", { name: `Synthetic public walk ${marker}` }),
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `http://127.0.0.1:5173/e/${publicLink.publicKey}`,
    );

    await page.goto(`/discover?q=${marker}`);
    await expect(
      page.getByRole("heading", { name: `Synthetic public walk ${marker}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `Synthetic unlisted walk ${marker}` }),
    ).toHaveCount(0);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(`/e/${publicLink.publicKey}`);

    const unlistedLink = await link(unlistedId);
    expect(sitemap).not.toContain(unlistedLink.publicKey);
    expect((await page.goto(`/e/${unlistedLink.publicKey}`))?.status()).toBe(404);
    const unlisted = await page.goto(`/u/${unlistedLink.publicKey}`);
    expect(unlisted?.headers()["x-robots-tag"]).toBe("noindex, nofollow, nosnippet, noimageindex");
    expect(unlisted?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByText(/Alla som har länken kan se det/u)).toBeVisible();

    const rotated = await request.post(`${base}/events/${unlistedId}/unlisted-link/rotate`, {
      headers,
      data: { expectedEventVersion: unlistedLink.version },
    });
    expect(rotated.status()).toBe(200);
    const replaced = (await rotated.json()).publicKey as string;
    expect((await page.goto(`/u/${unlistedLink.publicKey}`))?.status()).toBe(410);
    await expect(page.getByRole("heading", { name: "Sidan finns inte längre" })).toBeVisible();
    expect((await page.goto(`/u/${replaced}`))?.status()).toBe(200);

    // A public link cannot be replaced; cancellation keeps a sanitized notice.
    const refused = await request.post(`${base}/events/${publicId}/unlisted-link/rotate`, {
      headers,
      data: { expectedEventVersion: publicLink.version + 1 },
    });
    expect(refused.status()).toBe(409);
    const cancelled = await request.post(`${base}/events/${publicId}/cancel`, {
      headers,
      data: {
        confirmTitle: `Synthetic public walk ${marker}`,
        expectedEventVersion: (await link(publicId)).version,
        publicReason: "Storm warning",
      },
    });
    expect(cancelled.status()).toBe(200);
    await page.goto(`/e/${publicLink.publicKey}`);
    await expect(page.getByRole("status")).toContainText("Storm warning");
  } finally {
    await deleteSyntheticAccount(email);
  }
});

test("visitors search the public map, follow the safety feed and report a stop", async ({
  page,
}) => {
  test.setTimeout(90_000);
  if (!admin) throw new Error("Local test configuration missing");
  const marker = randomUUID().slice(0, 8);
  const emails = ["owner", "books", "toys"].map((role) => `map-${role}-${marker}@example.invalid`);
  const ids: string[] = [];
  for (const email of emails) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw error ?? new Error("User missing");
    ids.push(data.user.id);
  }
  const [owner, books, toys] = ids;
  try {
    // Fixture only: routing is not built yet, so publication is set directly.
    const eventKey = localSql(`
      select public.create_scheduled_draft_event_command('${owner}',null,'Map owner ${marker}','Map walk ${marker}','',
        'Europe/Stockholm','public', now()+interval '3 hours', now()+interval '8 hours', gen_random_uuid());
      select public.upsert_draft_event_boundary_command('${owner}',(select id from public.events where title='Map walk ${marker}'),null,'Area',
        '{"type":"Polygon","coordinates":[[[18.0600,59.3100],[18.0700,59.3100],[18.0700,59.3150],[18.0600,59.3150],[18.0600,59.3100]]]}'::jsonb,
        gen_random_uuid());
      update public.events set admission_mode='auto_inside' where title='Map walk ${marker}';
      select public.apply_to_event_command('${books}',(select id from public.events where title='Map walk ${marker}'),'Bokbord','Testgatan 1','','',
        18.062,59.312,'manual',null,true,gen_random_uuid());
      select public.apply_to_event_command('${toys}',(select id from public.events where title='Map walk ${marker}'),'Leksaksbord','Testgatan 2','','',
        18.066,59.313,'manual',null,true,gen_random_uuid());
      select public.save_seller_listing_command('${books}',(select id from public.seller_participations where account_id='${books}'),0,
        'Deckare','Pocket och inbundet',array['0199a000-0000-7000-8000-000000000005'::uuid],'{}',true,null,null,null,null,false,'[]','[]',
        gen_random_uuid());
      select public.save_seller_listing_command('${toys}',(select id from public.seller_participations where account_id='${toys}'),0,
        'Lego','',array['0199a000-0000-7000-8000-000000000006'::uuid],'{}',null,null,null,null,null,false,'[]','[]',gen_random_uuid());
      update public.events set state='published' where title='Map walk ${marker}';
      update public.events set state='active' where title='Map walk ${marker}';
      select app_private.refresh_public_snapshots_command();
      select public_key from public.events where title='Map walk ${marker}';`)
      .split("\n")
      .at(-1);
    const mapPage = await page.goto(`/e/${eventKey}/map`);
    expect(mapPage?.headers()["x-robots-tag"]).toBe("noindex, nofollow, nosnippet, noimageindex");
    const list = page.getByRole("region", { name: "Lista över stoppen" });
    await expect(list.getByRole("heading", { name: "Deckare" })).toBeVisible();
    await expect(list.getByRole("heading", { name: "Lego" })).toBeVisible();
    await expect(page.getByText("Testgatan")).toHaveCount(0);

    // English search words find the Swedish-labelled category.
    await page.getByLabel("Sök efter saker, kategorier eller säljare").fill("books");
    await expect(list.getByRole("heading", { name: "Deckare" })).toBeVisible();
    await expect(list.getByRole("heading", { name: "Lego" })).toHaveCount(0);
    await page.getByLabel("Sök efter saker, kategorier eller säljare").fill("");
    await page.getByLabel("Utan trappsteg").check();
    await expect(list.getByRole("heading", { name: "Lego" })).toHaveCount(0);
    await page.getByLabel("Utan trappsteg").uncheck();

    // Closing early reaches the open page through the safety feed, before any rebuild.
    localSql(`insert into public.seller_live_status(participation_id,status,set_by_account_id)
      select id,'closed_early','${toys}' from public.seller_participations where account_id='${toys}'
      on conflict (participation_id) do update set status='closed_early';`);
    await expect(list.getByRole("heading", { name: "Lego" })).toHaveCount(0, { timeout: 20_000 });

    // A visitor reports a stop by its public ID only. Fixture control: earlier
    // runs within the hour share the local network's 3-per-hour report limit.
    localSql("delete from app_private.report_rate_buckets;");
    await list.getByRole("link", { name: "Anmäl" }).first().click();
    await expect(page).toHaveURL(
      new RegExp(
        `/report\\?key=${eventKey}&route=public&type=participation&subject=[0-9a-f]{24}$`,
        "u",
      ),
    );
    await page.getByLabel("Vad gäller det?").selectOption("fraud");
    await page.getByLabel("Beskriv vad som är fel").fill("Säljer förfalskade böcker.");
    await page.getByRole("button", { name: "Skicka anmälan" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    expect(
      localSql(`select count(*) from app_private.reports r join app_private.moderation_cases c on c.id=r.case_id
        where c.subject_id=(select id from public.seller_participations where account_id='${books}');`),
    ).toBe("1");

    // Ending the event tombstones the map at once.
    localSql(`update public.events set state='ended' where title='Map walk ${marker}';`);
    await page.goto(`/e/${eventKey}/map`);
    await expect(page.getByText("Evenemanget pågår inte.")).toBeVisible();
  } finally {
    for (const email of emails) await deleteSyntheticAccount(email);
  }
});

test("hosts build, inspect, correct and approve the walking network", async ({
  context,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const marker = randomUUID().slice(0, 8);
  const email = `walking-${marker}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const sellers = ["street", "island"].map((role) => `walking-${role}-${marker}@example.invalid`);
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (createError) throw createError;
  const sellerIds: string[] = [];
  for (const sellerEmail of sellers) {
    const { data, error } = await admin.auth.admin.createUser({
      email: sellerEmail,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("User missing");
    sellerIds.push(data.user.id);
  }
  const client = createClient(localStatus.API_URL, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await client.auth.signInWithPassword({ email, password });
  const headers = {
    apikey: publicKey,
    authorization: `Bearer ${data.session?.access_token}`,
    origin: "http://127.0.0.1:5173",
  };
  try {
    const created = await request.post(`${base}/events`, {
      headers,
      data: {
        description: "Synthetic walking fixture",
        endsAt: "2031-09-21T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: `Walking organizer ${marker}`,
        startsAt: "2031-09-21T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: `Walking fixture ${marker}`,
        visibility: "public",
      },
    });
    const eventId = (await created.json()).id as string;
    const noBoundary = await request.post(`${base}/events/${eventId}/routing/builds`, { headers });
    expect((await noBoundary.json()).code).toBe("boundary_required");
    localSql(`
      select public.upsert_draft_event_boundary_command(created_by_account_id, id, null, 'Area',
        '{"type":"Polygon","coordinates":[[[18.0600,59.3100],[18.0720,59.3100],[18.0720,59.3160],[18.0600,59.3160],[18.0600,59.3100]]]}'::jsonb,
        gen_random_uuid()) from public.events where id='${eventId}';
      update public.events set admission_mode='auto_inside' where id='${eventId}';
      select public.apply_to_event_command('${sellerIds[0]}','${eventId}','Street stall','Testgatan 1','','',18.0632,59.3121,'manual',null,true,gen_random_uuid());
      select public.apply_to_event_command('${sellerIds[1]}','${eventId}','Courtyard stall','Testgatan 2','','',18.06775,59.3118,'manual',null,true,gen_random_uuid());`);

    const built = await request.post(`${base}/events/${eventId}/routing/builds`, { headers });
    expect(built.status()).toBe(200);
    const routing = await built.json();
    expect(routing.latest).toMatchObject({ state: "awaiting_host_preview" });
    expect(routing.latest.source.license).toBe("ODbL-1.0");
    const byName = (name: string) =>
      routing.latest.locations.find((location: { sellerNames: string[] }) =>
        location.sellerNames.includes(name),
      );
    expect(byName("Street stall").status).toBe("connected");
    expect(byName("Courtyard stall").status).toBe("disconnected");

    const preview = await request.get(
      `${base}/events/${eventId}/routing/builds/${routing.latest.id}/package`,
      { headers },
    );
    const pkg = await preview.json();
    expect(pkg.attribution).toContain("OpenStreetMap");
    expect(JSON.stringify(pkg)).not.toContain("Testgatan");

    const refused = await request.post(
      `${base}/events/${eventId}/routing/builds/${routing.latest.id}/confirm`,
      { headers },
    );
    expect((await refused.json()).code).toBe("disconnected_locations");

    // Join the courtyard with a short organizer-confirmed connection and block one street.
    const connector = await request.post(`${base}/events/${eventId}/routing/overrides`, {
      headers,
      data: {
        from: [18.06755, 59.3117],
        kind: "connector",
        reason: "Open gate into the courtyard",
        safeWalkingAttested: true,
        to: [18.067, 59.3114],
      },
    });
    expect(connector.status()).toBe(200);
    const blocked = await request.post(`${base}/events/${eventId}/routing/overrides`, {
      headers,
      data: { edgeKey: pkg.edgeKeys[0], kind: "block_edge", reason: "Roadworks all weekend" },
    });
    expect((await blocked.json()).overrides).toHaveLength(2);
    const outdated = await request.post(
      `${base}/events/${eventId}/routing/builds/${routing.latest.id}/confirm`,
      { headers },
    );
    expect((await outdated.json()).code).toBe("build_outdated");

    const rebuilt = await (
      await request.post(`${base}/events/${eventId}/routing/builds`, { headers })
    ).json();
    expect(
      rebuilt.latest.locations.every(
        (location: { status: string }) => location.status === "connected",
      ),
    ).toBe(true);
    const rebuiltPackage = await (
      await request.get(`${base}/events/${eventId}/routing/builds/${rebuilt.latest.id}/package`, {
        headers,
      })
    ).json();
    expect(rebuiltPackage.edgeKeys).not.toContain(pkg.edgeKeys[0]);
    expect(rebuiltPackage.edgeKeys.some((key: string) => key.startsWith("c:"))).toBe(true);

    const confirmed = await request.post(
      `${base}/events/${eventId}/routing/builds/${rebuilt.latest.id}/confirm`,
      { headers },
    );
    expect((await confirmed.json()).ready).toBe(true);
    const readiness = await (
      await request.get(`${base}/events/${eventId}/publication-readiness`, { headers })
    ).json();
    expect(readiness.blockers).not.toContain("routing_not_ready");

    // Fixture only: the remaining publication gates are covered elsewhere.
    localSql(`update public.events set state='published' where id='${eventId}';`);
    const eventKey = localSql(`select public_key from public.events where id='${eventId}';`);
    const manifest = await (await request.get(`${base}/public/events/${eventKey}/manifest`)).json();
    expect(manifest.routing).toMatchObject({ id: manifest.routingVersion });
    const publicPackage = await request.get(`${base}/public/routing/${manifest.routing.id}`);
    expect(publicPackage.headers()["cache-control"]).toContain("immutable");
    expect((await publicPackage.json()).edgeKeys).toEqual(rebuiltPackage.edgeKeys);
    expect((await request.get(`${base}/public/routing/${routing.latest.id}`)).status()).toBe(404);

    // A visitor plans and starts a walk; progress stays on the device.
    localSql(`update public.events set state='active' where id='${eventId}';
      select app_private.refresh_public_snapshots_command();`);
    const mapResponse = await page.goto(`/e/${eventKey}/map`);
    expect(mapResponse?.headers()["permissions-policy"]).toContain("geolocation=(self)");
    const addToWalk = page.getByLabel("Lägg till i promenaden");
    await expect(addToWalk).toHaveCount(2);
    await addToWalk.nth(0).check();
    await addToWalk.nth(1).check();
    await page.getByRole("button", { name: "Planera promenaden" }).click();
    const planner = page.getByRole("region", { name: "Planera en promenad" });
    await expect(planner.getByText(/Gång \d+ min/u)).toBeVisible();
    await expect(planner.getByRole("heading", { name: /^1\. Stopp/u })).toBeVisible();
    await expect(planner.getByRole("heading", { name: /^2\. Stopp/u })).toBeVisible();
    await planner.getByRole("button", { name: "Starta promenaden" }).click();
    await planner.getByRole("button", { name: "Markera besökt" }).first().click();
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Planera en promenad" }).getByText(/· Besökt/u),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some((k) => k.startsWith("promenadis-route:")),
      ),
    ).toBe(true);

    // An unsafe segment blocked during the event is offered, never applied silently.
    const live = await request.post(`${base}/events/${eventId}/routing/overrides`, {
      headers,
      data: { edgeKey: rebuiltPackage.edgeKeys[5], kind: "block_edge", reason: "Fallen tree" },
    });
    expect(live.status()).toBe(200);
    await expect(page.getByText(/Gångnätet har ändrats/u)).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("region", { name: "Planera en promenad" }).getByText(/· Besökt/u),
    ).toBeVisible();

    // Connection loss: the started walk keeps working from the device copy,
    // clearly marked; reconnecting validates fresh state first.
    await context.setOffline(true);
    await expect(page.getByText(/Du är offline/u)).toBeVisible({ timeout: 20_000 });
    await expect(
      page
        .getByRole("region", { name: "Lista över stoppen" })
        .getByRole("heading", { name: "Stopp 1" }),
    ).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText(/Du är offline/u)).toHaveCount(0, { timeout: 20_000 });
  } finally {
    await deleteSyntheticAccount(email);
    for (const sellerEmail of sellers) await deleteSyntheticAccount(sellerEmail);
  }
});

test("visitors contact organizers through the relay and hosts export sellers", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const marker = randomUUID().slice(0, 8);
  const email = `relay-owner-${marker}@example.invalid`;
  const visitor = `relay-visitor-${marker}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (error || !created.user) throw error ?? new Error("User missing");
  const { data: seller } = await admin.auth.admin.createUser({
    email: `relay-seller-${marker}@example.invalid`,
    email_confirm: true,
  });
  const client = createClient(localStatus.API_URL, publicKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await client.auth.signInWithPassword({ email, password });
  const headers = {
    apikey: publicKey,
    authorization: `Bearer ${data.session?.access_token}`,
    origin: "http://127.0.0.1:5173",
  };
  try {
    const eventId = localSql(`
      select public.create_scheduled_draft_event_command('${created.user.id}',null,'Relay owner','Relay walk ${marker}','',
        'Europe/Stockholm','public', now()+interval '3 days', now()+interval '3 days 4 hours', gen_random_uuid());
      select public.upsert_draft_event_boundary_command('${created.user.id}',(select id from public.events where title='Relay walk ${marker}'),null,'Area',
        '{"type":"Polygon","coordinates":[[[18.0600,59.3100],[18.0720,59.3100],[18.0720,59.3160],[18.0600,59.3160],[18.0600,59.3100]]]}'::jsonb,
        gen_random_uuid());
      update public.events set admission_mode='auto_inside' where title='Relay walk ${marker}';
      select public.apply_to_event_command('${seller?.user?.id}',(select id from public.events where title='Relay walk ${marker}'),
        '=HYPERLINK("x")','Testgatan 9','11122','Stockholm',18.0632,59.3121,'manual',null,true,gen_random_uuid());
      update public.events set state='published' where title='Relay walk ${marker}';
      select id from public.events where title='Relay walk ${marker}';`)
      .split("\n")
      .at(-1) as string;
    const eventKey = localSql(`select public_key from public.events where id='${eventId}';`);

    await page.goto(`/e/${eventKey}`);
    await page.getByText("Kontakta arrangören").click();
    await page.getByLabel("Din e-postadress (för svar)").fill(visitor);
    await page.getByLabel("Meddelande").fill("Finns det parkering nära loppisen?");
    await page.getByRole("button", { name: "Skicka" }).click();
    await expect(page).toHaveURL(/\/contact\/[0-9a-f-]{36}#[0-9a-f]{64}$/u);
    await expect(page.getByText("Finns det parkering nära loppisen?")).toBeVisible();
    const threadUrl = page.url();

    const threads = await (
      await request.get(`${base}/events/${eventId}/messages`, { headers })
    ).json();
    expect(JSON.stringify(threads)).not.toContain(visitor);
    const replied = await request.post(
      `${base}/events/${eventId}/messages/${threads[0].id}/reply`,
      {
        headers,
        data: { message: "Ja, på sidogatan bakom torget." },
      },
    );
    expect(replied.status()).toBe(200);
    execFileSync("node", ["scripts/deliver-local-application-notifications.mjs"], {
      cwd: repositoryRoot,
    });
    const mail = await latestMessage(request, visitor);
    expect(mail.Text).toContain("Ja, på sidogatan bakom torget.");
    expect(mail.Text).toContain(threadUrl.slice(threadUrl.indexOf("/contact/")));
    expect(mail.Text).not.toContain(email);
    await page.reload();
    await expect(page.getByText("Ja, på sidogatan bakom torget.")).toBeVisible();

    // Export: approved sellers' public operational fields, once, neutralized.
    const exported = await request.post(`${base}/events/${eventId}/exports`, { headers });
    expect(exported.status()).toBe(201);
    const { exportId, token } = await exported.json();
    const download = await request.post(`${base}/events/${eventId}/exports/${exportId}/download`, {
      headers,
      data: { token },
    });
    expect(download.headers()["content-type"]).toContain("text/csv");
    const csv = await download.text();
    expect(csv).toContain('"Testgatan 9","11122","Stockholm","\'=HYPERLINK(""x"")"');
    expect(csv).not.toContain("@example.invalid");
    const again = await request.post(`${base}/events/${eventId}/exports/${exportId}/download`, {
      headers,
      data: { token },
    });
    expect(again.status()).toBe(410);
  } finally {
    await deleteSyntheticAccount(email);
    await deleteSyntheticAccount(`relay-seller-${marker}@example.invalid`);
  }
});

test("support requests reach the mailbox and visitors leave anonymous feedback", async ({
  page,
  request,
}) => {
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const marker = randomUUID().slice(0, 8);
  localSql(
    "delete from app_private.support_requests; delete from app_private.feedback_rate_buckets;",
  );
  const status = await (await request.get(`${base}/status`)).json();
  expect(Object.keys(status)).toEqual(["status"]);

  await page.goto("/support?topic=accessibility");
  await expect(page.getByLabel("Ämne")).toHaveValue("accessibility");
  await page
    .getByLabel("Meddelande")
    .fill(`Kartan går inte att använda med skärmläsare ${marker}.`);
  await page.getByLabel("E-post för svar (valfritt)").fill(`support-${marker}@example.invalid`);
  await page.getByRole("button", { name: "Skicka" }).click();
  await expect(page.getByRole("status")).toHaveText("Tack. Vi har tagit emot ditt meddelande.");
  execFileSync("node", ["scripts/deliver-local-application-notifications.mjs"], {
    cwd: repositoryRoot,
  });
  const mail = await latestMessage(request, "support@promenadis.local");
  expect(mail.Text).toContain(marker);
  expect(mail.Text).toContain("Topic: accessibility");

  const { data: owner } = await admin.auth.admin.createUser({
    email: `feedback-${marker}@example.invalid`,
    email_confirm: true,
  });
  try {
    const eventKey = localSql(`
      select public.create_scheduled_draft_event_command('${owner?.user?.id}',null,'Feedback owner','Feedback walk ${marker}','',
        'Europe/Stockholm','public', now()+interval '1 day', now()+interval '1 day 4 hours', gen_random_uuid());
      update public.events set state='published' where title='Feedback walk ${marker}';
      update public.events set state='active' where title='Feedback walk ${marker}';
      update public.events set state='ended' where title='Feedback walk ${marker}';
      select public_key from public.events where title='Feedback walk ${marker}';`)
      .split("\n")
      .at(-1);
    await page.goto(`/e/${eventKey}`);
    await page.getByRole("radio", { exact: true, name: "4" }).check();
    await page.getByLabel("Kommentar (valfritt)").fill("Trevlig promenad");
    await page.getByRole("button", { name: "Skicka" }).click();
    await expect(page.getByText("Tack för ditt svar!")).toBeVisible();
    expect(
      localSql(`select rating from app_private.event_feedback f join public.events e on e.id=f.event_id
        where e.title='Feedback walk ${marker}';`),
    ).toBe("4");
  } finally {
    await deleteSyntheticAccount(`feedback-${marker}@example.invalid`);
  }
});

test("protected routes refuse anonymous callers and pages send security headers", async ({
  page,
  request,
}) => {
  if (!localStatus) throw new Error("Local test configuration missing");
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const id = randomUUID();
  const protectedRoutes: Array<["GET" | "POST", string]> = [
    ["POST", "/events"],
    ["GET", "/notifications"],
    ["GET", "/participations"],
    ["GET", "/account/notification-preferences"],
    ["GET", `/events/${id}/routing`],
    ["GET", `/events/${id}/messages`],
    ["POST", `/events/${id}/exports`],
    ["GET", `/events/${id}/public-link`],
    ["GET", "/admin/operations"],
    ["GET", "/admin/support"],
  ];
  for (const [method, path] of protectedRoutes) {
    const response = await request.fetch(`${base}${path}`, {
      data: method === "POST" ? {} : undefined,
      headers: { origin: "http://127.0.0.1:5173" },
      method,
    });
    expect(response.status(), `${method} ${path}`).toBe(401);
  }
  // A forged origin is refused before any route runs.
  const foreign = await request.get(`${base}/status`, {
    headers: { origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);
  // The browser gateway refuses cross-site requests without its header.
  const gateway = await request.get("/api/notifications");
  expect(gateway.status()).toBe(403);

  const home = await page.goto("/");
  const headers = home?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});

test("organization verification needs a valid number and an elevated reviewer", async ({
  request,
}) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const managerEmail = `verify-manager-${randomUUID()}@example.invalid`;
  const adminEmail = `verify-admin-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const signIn = async (email: string) => {
    const client = createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return { client, token: data.session?.access_token };
  };
  const headersFor = (token: string | undefined) => ({
    apikey: publicKey,
    authorization: `Bearer ${token}`,
    origin: "http://127.0.0.1:5173",
  });
  for (const email of [managerEmail, adminEmail]) {
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, password });
    if (error) throw error;
  }
  try {
    const manager = headersFor((await signIn(managerEmail)).token);
    const created = await request.post(`${base}/organizers`, {
      headers: manager,
      data: {
        displayName: "Synthetic Association",
        locality: "Stockholm",
        organizerType: "association",
        website: "https://example.invalid",
      },
    });
    expect(created.status()).toBe(201);
    const organizerId = (await created.json()).id as string;
    const personal = await request.post(`${base}/organizers/${organizerId}/verification`, {
      headers: manager,
      data: {
        controlMethod: "official_website",
        controlReference: "https://example.invalid",
        organizationNumber: "811218-9876",
      },
    });
    expect(personal.status()).toBe(400);
    const requested = await request.post(`${base}/organizers/${organizerId}/verification`, {
      headers: manager,
      data: {
        controlMethod: "official_website",
        controlReference: "https://example.invalid",
        organizationNumber: "5560160680",
      },
    });
    expect(await requested.json()).toMatchObject({
      organizationNumber: "556016-0680",
      status: "pending",
    });

    const adminSession = await signIn(adminEmail);
    const enrolled = await (
      await request.post(`${base}/account/mfa/totp`, {
        headers: headersFor(adminSession.token),
        data: {},
      })
    ).json();
    const upgraded = await adminSession.client.auth.mfa.challengeAndVerify({
      factorId: enrolled.factorId,
      code: totp(enrolled.secret),
    });
    const adminHeaders = headersFor(upgraded.data?.access_token);
    execFileSync("node", ["scripts/grant-local-admin.mjs", adminEmail], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
    expect(
      (
        await request.get(`${base}/admin/organizer-verifications`, { headers: adminHeaders })
      ).status(),
    ).toBe(403);
    await request.post(`${base}/admin/elevation`, {
      headers: adminHeaders,
      data: { code: totp(enrolled.secret) },
    });
    const queue = await (
      await request.get(`${base}/admin/organizer-verifications`, { headers: adminHeaders })
    ).json();
    expect(
      queue.find((item: { organizerProfileId: string }) => item.organizerProfileId === organizerId),
    ).toMatchObject({ organizationNumber: "556016-0680", ownOrganizer: false });
    const unconfirmed = await request.post(
      `${base}/admin/organizer-verifications/${organizerId}/decision`,
      {
        headers: adminHeaders,
        data: { decision: "verified", registeredName: "Example Förening", registryActive: true },
      },
    );
    expect(unconfirmed.status()).toBe(400);
    const verified = await request.post(
      `${base}/admin/organizer-verifications/${organizerId}/decision`,
      {
        headers: adminHeaders,
        data: {
          controlConfirmed: true,
          decision: "verified",
          registeredName: "Example Förening",
          registryActive: true,
        },
      },
    );
    expect(verified.status()).toBe(200);
    const status = await (
      await request.get(`${base}/organizers/${organizerId}/verification`, { headers: manager })
    ).json();
    expect(status).toMatchObject({ badge: true, registeredName: "Example Förening" });
  } finally {
    await deleteSyntheticAccount(adminEmail);
    await deleteSyntheticAccount(managerEmail);
  }
});

test("an authenticator code can replace the recovery code to recover an owner account", async ({
  request,
}) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local test configuration missing");
  const publicKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;
  const base = `${localStatus.API_URL}/functions/v1/api-v1`;
  const email = `totp-recovery-${randomUUID()}@example.invalid`;
  const newEmail = `totp-recovery-new-${randomUUID()}@example.invalid`;
  const password = `Local-test-${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (createError) throw createError;
  const accountId = created.user.id;
  const anonymous = { apikey: publicKey, origin: "http://127.0.0.1:5173" };
  try {
    const owner = createClient(localStatus.API_URL, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await owner.auth.signInWithPassword({ email, password });
    const headers = {
      ...anonymous,
      authorization: `Bearer ${signedIn.data.session?.access_token}`,
    };
    const event = await request.post(`${base}/events`, {
      headers,
      data: {
        description: "Synthetic TOTP recovery fixture",
        endsAt: "2031-09-14T15:00:00+02:00",
        organizerProfileId: null,
        publicOrganizerName: "Synthetic TOTP owner",
        startsAt: "2031-09-14T10:00:00+02:00",
        timezone: "Europe/Stockholm",
        title: "Synthetic TOTP walk",
        visibility: "unlisted",
      },
    });
    expect(event.status()).toBe(201);
    const enrolled = await (
      await request.post(`${base}/account/mfa/totp`, { headers, data: {} })
    ).json();
    const verifiedFactor = await owner.auth.mfa.challengeAndVerify({
      factorId: enrolled.factorId,
      code: totp(enrolled.secret),
    });
    expect(verifiedFactor.error).toBeNull();

    // Anonymous, email lost: prove possession of the authenticator instead.
    const wrong = await request.post(`${base}/account-recovery`, {
      headers: anonymous,
      data: { currentEmail: email, newEmail, totpCode: totp(enrolled.secret, 5) },
    });
    expect(wrong.status()).toBe(400);
    expect((await wrong.json()).code).toBe("invalid_recovery");
    const both = await request.post(`${base}/account-recovery`, {
      headers: anonymous,
      data: {
        currentEmail: email,
        newEmail,
        recoveryCode: "ABCD-EFGH-JKLM-NPQR-STUV",
        totpCode: "123456",
      },
    });
    expect(both.status()).toBe(400);
    // The same 30-second step was already used to verify the factor.
    const started = await request.post(`${base}/account-recovery`, {
      headers: anonymous,
      data: { currentEmail: email, newEmail, totpCode: totp(enrolled.secret, 1) },
    });
    expect(started.status()).toBe(201);
    const claim = await started.json();
    const message = await latestMessage(request, newEmail);
    const link = message.Text.match(/http:\/\/127\.0\.0\.1:5173\/recover-account#[^\s]+/u)?.[0];
    const token = new URLSearchParams(new URL(link ?? "").hash.slice(1)).get("token");
    const verified = await request.post(`${base}/account-recovery/${claim.id}/verify`, {
      headers: anonymous,
      data: { verificationToken: token },
    });
    expect(verified.status()).toBe(200);

    localSql(`update app_private.account_recovery_claims
      set initiated_at=now()-interval '2 days', email_verified_at=now()-interval '2 days'+interval '1 minute',
        ready_at=now()-interval '1 hour', expires_at=now()+interval '4 days'
      where id='${claim.id}' and account_id='${accountId}' and method='totp';
      update app_private.notification_jobs set completed_at=now()
      where source_id='${claim.id}' and template_key='account_recovery_started';`);
    const completed = await request.post(`${base}/account-recovery/${claim.id}/complete`, {
      headers: anonymous,
      data: { verificationToken: token },
    });
    expect(await completed.json()).toMatchObject({ state: "completed" });
    expect((await admin.auth.admin.getUserById(accountId)).data.user?.email).toBe(newEmail);
  } finally {
    await deleteSyntheticAccount(newEmail);
    await deleteSyntheticAccount(email);
  }
});

test("the visible email OTP signs in", async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = `otp-${randomUUID()}@example.invalid`;
  const helperEmail = `otp-helper-${randomUUID()}@example.invalid`;
  try {
    await page.goto("/sign-in");
    await page.getByRole("textbox", { name: "E-postadress" }).fill(email);
    await page.getByRole("button", { name: "Skicka kod" }).click();
    await expect(page.getByText(/Meddelandet är skickat/u)).toBeVisible();

    const message = await latestMessage(request, email);
    const token = message.Text.match(/(?:^|[^0-9])([0-9]{6})(?:[^0-9]|$)/u)?.[1];
    expect(token).toBeTruthy();

    await page.getByRole("textbox", { name: "Engångskod" }).fill(token ?? "");
    await page.getByRole("button", { name: "Verifiera kod" }).click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mina evenemang");

    await page.getByRole("link", { name: "Skapa mitt första evenemang" }).click();
    await expect(page).toHaveURL(/\/events\/new$/u);
    await expect(page.getByText("Arrangeras av dig")).toBeVisible();

    await page.getByRole("textbox", { name: "Namn som visas offentligt" }).fill("Testperson");
    await page.getByRole("textbox", { name: "Evenemangets titel" }).fill("Syntetisk promenad");
    expect(
      await page.locator("form").evaluate((form) => (form as HTMLFormElement).checkValidity()),
    ).toBe(true);
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/events") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Fortsätt till området" }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status(), await createResponse.text()).toBe(201);

    await expect(page).toHaveURL(/\/events\/[0-9a-f-]+\/area\?new=1$/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Evenemangsområde");
    await page.getByText("Avancerat: redigera koordinater").click();

    const addBoundaryPoint = async (longitude: string, latitude: string) => {
      await page.getByLabel("Longitud", { exact: true }).fill(longitude);
      await page.getByLabel("Latitud", { exact: true }).fill(latitude);
      await page.getByRole("button", { name: "Lägg till hörn", exact: true }).click();
    };
    await page.getByLabel("Områdets namn (valfritt)").fill("Syntetiskt område");
    await addBoundaryPoint("18", "59");
    await addBoundaryPoint("18.01", "59");
    await addBoundaryPoint("18.01", "59.01");
    await page.getByRole("button", { name: "Spara område" }).click();
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]+\/review$/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kontrollera utkastet");
    await expect(page.getByRole("heading", { name: "Syntetisk promenad" })).toBeVisible();
    await expect(page.getByText("Säljaranmälan")).toBeVisible();

    await page.getByRole("link", { name: "Gå till evenemanget" }).click();
    await page.getByRole("link", { name: "Ändra anmälan" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Säljaranmälan");
    await expect(page.getByLabel("Anmälan öppnar")).not.toHaveValue("");
    await expect(page.getByLabel("Anmälan stänger")).not.toHaveValue("");
    await page.getByRole("button", { name: "Spara anmälningsperiod" }).click();
    await expect(page.getByText("Anmälningsperioden har sparats.")).toBeVisible();

    await page.getByRole("link", { name: "Till evenemanget" }).click();
    await page.getByLabel("Synlighet").selectOption("unlisted");
    await page.getByRole("button", { name: "Spara synlighet" }).click();
    await expect(page.getByText("Synligheten har sparats.")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Evenemangsteam" })).toBeVisible();
    await page.getByLabel("E-postadress").fill(helperEmail);
    await page.getByLabel("Roll").selectOption("moderator");
    await page.getByRole("button", { name: "Skapa inbjudan" }).click();
    await expect(page.getByText(helperEmail)).toBeVisible();
    await page.getByRole("button", { name: "Återkalla" }).click();
    await expect(
      page.getByText("Inbjudan har återkallats och e-postadressen har raderats."),
    ).toBeVisible();

    await page.getByText("Radera utkast", { exact: true }).click();
    await page
      .getByLabel("Skriv evenemangets exakta titel för att bekräfta")
      .fill("Syntetisk promenad");
    await page.getByRole("button", { name: "Radera utkast permanent" }).click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mina evenemang");
    await expect(page.getByRole("heading", { name: "Syntetisk promenad" })).toHaveCount(0);

    await page.getByRole("link", { name: "Inställningar" }).click();
    await expect(
      page.getByRole("heading", { name: "Din offentliga arrangörsidentitet" }),
    ).toBeVisible();
    await expect(page.getByText("Testperson", { exact: true })).toBeVisible();
    await page.getByText("Lägg till en annan arrangör").click();
    await page.locator("#organizer-name").fill("Syntetisk kvartersgrupp");
    await page.getByRole("button", { name: "Skapa arrangör" }).click();
    await expect(page.getByText("Syntetisk kvartersgrupp", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Personer som hanterar arrangören" }),
    ).toBeVisible();
    await page.getByLabel("Bjud in hanterare via e-post").fill(helperEmail);
    await page.getByRole("button", { name: "Skapa hanterarinbjudan" }).click();
    await expect(page.getByText(helperEmail, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Återkalla" }).click();
    await expect(page.getByText("Hanterarinbjudan har återkallats.")).toBeVisible();
  } finally {
    await deleteSyntheticAccount(email);
  }
});

test("the newest magic link performs one PKCE exchange", async ({ page, request }) => {
  const email = `link-${randomUUID()}@example.invalid`;
  try {
    await page.goto("/sign-in");
    await page.getByRole("textbox", { name: "E-postadress" }).fill(email);
    await page.getByRole("button", { name: "Skicka kod" }).click();
    await expect(page.getByText(/Meddelandet är skickat/u)).toBeVisible();

    const message = await latestMessage(request, email);
    const encodedLink = message.HTML.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/u)?.[1];
    expect(encodedLink).toBeTruthy();

    let exchanges = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/auth/exchange")) exchanges++;
    });
    await page.goto((encodedLink ?? "").replaceAll("&amp;", "&"));
    await expect(page).toHaveURL(/\/dashboard$/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mina evenemang");
    expect(exchanges).toBe(1);
  } finally {
    await deleteSyntheticAccount(email);
  }
});

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "E-postadress" }).fill(email);
  await page.getByRole("button", { name: "Skicka kod" }).click();
  await expect(page.getByText(/Meddelandet är skickat/u)).toBeVisible();
  const message = await latestMessage(page.request, email);
  const token = message.Text.match(/(?:^|[^0-9])([0-9]{6})(?:[^0-9]|$)/u)?.[1];
  expect(token).toBeTruthy();
  const staleForm = await page.request.post("/api/auth/verify", {
    headers: { origin: "http://127.0.0.1:5173", "x-promenadis-browser": "1" },
    data: { email: "different-displayed-email@example.invalid", token },
  });
  expect(staleForm.status()).toBe(409);
  await page.getByRole("textbox", { name: "Engångskod" }).fill(token ?? "");
  await page.getByRole("button", { name: "Verifiera kod" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

test("opaque sessions isolate accounts, fence stale writes, refresh safely, and revoke on logout", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  if (!admin || !localStatus) throw new Error("Local configuration missing");
  const firstEmail = `isolated-a-${randomUUID()}@example.invalid`;
  const secondEmail = `isolated-b-${randomUUID()}@example.invalid`;
  const first = await browser.newContext({ baseURL: "http://127.0.0.1:5173" });
  const second = await browser.newContext({ baseURL: "http://127.0.0.1:5173" });
  const a = await first.newPage();
  const b = await second.newPage();
  const headers = { origin: "http://127.0.0.1:5173", "x-promenadis-browser": "1" };
  const session = async (page: Page) =>
    (await (await page.request.get("/api/auth/session", { headers })).json()).session;
  try {
    await signIn(a, firstEmail);
    await signIn(b, secondEmail);
    const one = await session(a);
    const two = await session(b);
    expect(one.user.id).not.toBe(two.user.id);
    expect(Object.keys(one)).toEqual(["user"]);
    expect(Object.keys(two.user).sort()).toEqual(["email", "id"]);
    for (const [page, name] of [
      [a, "Synthetic Alpha"],
      [b, "Synthetic Beta"],
    ] as const) {
      await page.goto("/settings");
      await expect(page.locator("#profile-display-name")).toBeVisible();
      await page.locator("#profile-display-name").fill(name);
      const saved = page.waitForResponse(
        (r) => r.url().endsWith("/api/profile") && r.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Spara profil" }).click();
      expect((await saved).status()).toBe(200);
      await page.reload();
      await expect(page.locator("#profile-display-name")).toHaveValue(name);
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage).filter((key) => key.includes("auth-token")),
        ),
      ).toEqual([]);
      expect(await page.evaluate(() => document.cookie)).not.toContain("promenadis-session");
    }
    const cookie = (await first.cookies()).find((c) => c.name === "promenadis-session");
    if (!cookie) throw new Error("Synthetic session missing");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(cookie?.path).toBe("/api");
    const denied = await a.request.put("/api/profile", {
      headers: { ...headers, "x-account-id": two.user.id },
      data: { displayName: "Wrong account", preferredLocale: "sv" },
    });
    expect(denied.status()).toBe(409);
    const csrf = await a.request.put("/api/profile", {
      headers: { origin: "https://attacker.invalid" },
      data: { displayName: "CSRF", preferredLocale: "sv" },
    });
    expect(csrf.status()).toBe(403);
    const noHeader = await a.request.put("/api/profile", {
      headers: { origin: headers.origin },
      data: { displayName: "Missing header", preferredLocale: "sv" },
    });
    expect(noHeader.status()).toBe(403);

    // Force only this synthetic session into refresh, then race reads. No raw
    // credentials are logged or placed in a browser; only the server fixture decrypts.
    const digest = createHash("sha256")
      .update(cookie?.value ?? "")
      .digest("hex");
    const lease = randomUUID();
    const taken = await admin.rpc("take_browser_session_command", {
      p_hash: digest,
      p_kind: "authenticated",
      p_lease: lease,
    });
    expect(taken.error).toBeNull();
    const keyBytes = createHash("sha256")
      .update(`promenadis/browser-sessions/local/v1/${localStatus.SERVICE_ROLE_KEY}`)
      .digest();
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    const bytes = Buffer.from(taken.data.payload, "base64");
    const additionalData = new TextEncoder().encode(`authenticated:${digest}`);
    const payload = JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData },
          key,
          bytes.subarray(12),
        ),
      ),
    );
    payload.expiresAt = 0;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData },
      key,
      new TextEncoder().encode(JSON.stringify(payload)),
    );
    const released = await admin.rpc("release_browser_session_command", {
      p_hash: digest,
      p_lease: lease,
      p_payload: Buffer.concat([iv, new Uint8Array(encrypted)]).toString("base64"),
    });
    expect(released.data).toBe(true);
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => session(a)));
    expect(concurrent.every((value) => value.user.id === one.user.id)).toBe(true);
    expect((await session(b)).user.id).toBe(two.user.id);

    // Simulate a shared cookie changing underneath an already-open settings form.
    const secondCookie = (await second.cookies()).find((c) => c.name === "promenadis-session");
    if (!secondCookie) throw new Error("Synthetic session missing");
    await first.addCookies([secondCookie]);
    await a.locator("#profile-display-name").fill("Stale Alpha form");
    await a.getByRole("button", { name: "Spara profil" }).click();
    await expect(a.locator("#profile-display-name")).toHaveValue("Synthetic Beta");
    await first.addCookies([cookie]);
    await a.reload();
    await expect(a.locator("#profile-display-name")).toHaveValue("Synthetic Alpha");
    await a.getByRole("button", { name: "Logga ut" }).click();
    await expect(a).toHaveURL(/\/sign-in$/u);
    expect(await session(a)).toBeNull();
    await first.addCookies([cookie]);
    expect(await session(a)).toBeNull(); // Deleted handle cannot be replayed.
    await b.reload();
    await expect(b.locator("#profile-display-name")).toHaveValue("Synthetic Beta");
  } finally {
    await first.close();
    await second.close();
    await deleteSyntheticAccount(firstEmail);
    await deleteSyntheticAccount(secondEmail);
  }
});
