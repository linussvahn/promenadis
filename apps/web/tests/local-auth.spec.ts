import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
    await page.getByLabel("Arrangörens visningsnamn").fill("Syntetisk kvartersgrupp");
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
