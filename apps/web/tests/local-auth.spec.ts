import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
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
