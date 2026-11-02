import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";

// Synthetic load at the launch envelope: one event with 500 sellers at 450
// locations, then visitor-style polling of the manifest, safety feed and
// snapshot. Locally this measures the BFF without a CDN; hosted reads go
// through the CDN and conditional requests.
const API = "http://127.0.0.1:54321/functions/v1/api-v1";
const sql = (input) =>
  execFileSync(
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
    ],
    { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 },
  ).trim();
const run = randomUUID().slice(0, 8);
const title = `Load envelope ${run}`;
const owner = randomUUID();
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const percentile = (values, p) =>
  values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];

// Paid entitlements above 30 sellers are not built yet; the fixture lifts
// the cap for the test only and the finally block restores it.
sql(`alter table public.event_entitlements drop constraint event_entitlements_seller_limit_check;
  alter table public.event_entitlements add constraint event_entitlements_seller_limit_check
    check (seller_limit >= 0 and seller_limit <= 500) not valid;`);
try {
  let started = Date.now();
  const eventId = sql(`
    insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values ('${owner}','load-owner-${run}@example.invalid',now(),now(),now());
    insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
      select gen_random_uuid(),'load-${run}-'||n||'@example.invalid',now(),now(),now() from generate_series(1,500) n;
    select public.create_scheduled_draft_event_command('${owner}',null,'Load owner','${title}','Synthetic envelope','Europe/Stockholm','public',
      now()+interval '3 hours', now()+interval '9 hours', gen_random_uuid());
    select public.upsert_draft_event_boundary_command('${owner}',(select id from public.events where title='${title}'),null,'Area',
      '{"type":"Polygon","coordinates":[[[18.0600,59.3100],[18.0720,59.3100],[18.0720,59.3160],[18.0600,59.3160],[18.0600,59.3100]]]}'::jsonb,
      gen_random_uuid());
    update public.events set admission_mode='auto_inside' where title='${title}';
    update public.event_entitlements set seller_limit=500 where event_id=(select id from public.events where title='${title}');
    select id from public.events where title='${title}';`)
    .split("\n")
    .at(-1);
  // 450 locations on a grid; the first 50 are shared by two sellers each.
  sql(`
    do $$
    declare
      seller record;
      n integer := 0;
      spot integer;
      participation uuid;
    begin
      for seller in select id from auth.users where email like 'load-${run}-%' order by email loop
        spot := n % 450;
        perform public.apply_to_event_command(seller.id, '${eventId}', 'Säljare ' || n, 'Lastgatan ' || spot, '11122', 'Stockholm',
          18.0605 + (spot % 25) * 0.00045, 59.3103 + (spot / 25) * 0.00030, 'manual', true, true, gen_random_uuid());
        select id into participation from public.seller_participations where account_id = seller.id;
        perform public.save_seller_listing_command(seller.id, participation, 0, 'Bord ' || n,
          'Böcker, kläder och lite av varje från förrådet. Fynd för alla åldrar.',
          array['0199a000-0000-7000-8000-000000000005'::uuid, '0199a000-0000-7000-8000-000000000002'::uuid],
          array['vinyl', 'barnkläder', 'retro'], true, false, null, 'outdoor', true, false,
          '[{"name":"Atlas 1962","categoryId":"0199a000-0000-7000-8000-000000000005","status":"available","priceMinor":5000,"currency":"SEK"},
            {"name":"Vinterjacka strl 110","categoryId":"0199a000-0000-7000-8000-000000000002","status":"available","priceMinor":15000,"currency":"SEK"}]',
          '[]', gen_random_uuid());
        n := n + 1;
      end loop;
    end $$;`);
  const seedMs = Date.now() - started;
  sql(
    `update public.events set state='published' where id='${eventId}'; update public.events set state='active' where id='${eventId}';`,
  );
  started = Date.now();
  sql("select app_private.refresh_public_snapshots_command();");
  const buildMs = Date.now() - started;
  const key = sql(`select public_key from public.events where id='${eventId}';`);
  const manifest = await (await fetch(`${API}/public/events/${key}/manifest`)).json();
  const snapshotText = await (
    await fetch(`${API}/public/snapshots/${manifest.snapshot.id}`)
  ).text();
  const snapshot = JSON.parse(snapshotText);
  const feedText = await (await fetch(`${API}/public/events/${key}/safety`)).text();
  const snapshotGzip = gzipSync(snapshotText).length;
  assert(
    snapshot.counts.sellers === 500 && snapshot.counts.stops === 450,
    "Snapshot does not hold the envelope.",
  );
  assert(snapshotText.length <= 2 * 1024 * 1024, "Snapshot exceeds the 2 MiB hard limit.");
  assert(snapshotGzip <= 500 * 1024, "Snapshot exceeds the 500 KiB compressed target.");
  assert(feedText.length <= 32 * 1024, "Safety feed exceeds 32 KiB.");

  // Visitors: conditional feed polls dominate, plus manifests and snapshots.
  const etag = (await fetch(`${API}/public/events/${key}/safety`)).headers.get("etag");
  const jobs = [
    ...Array.from({ length: 1500 }, () => ({ etag, path: `/public/events/${key}/safety` })),
    ...Array.from({ length: 300 }, () => ({ path: `/public/events/${key}/manifest` })),
    ...Array.from({ length: 50 }, () => ({ path: `/public/snapshots/${manifest.snapshot.id}` })),
  ];
  const latencies = [];
  const statuses = {};
  let next = 0;
  started = Date.now();
  await Promise.all(
    Array.from({ length: 50 }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const t0 = performance.now();
        const response = await fetch(`${API}${job.path}`, {
          headers: job.etag ? { "if-none-match": job.etag } : {},
        });
        await response.arrayBuffer();
        latencies.push(performance.now() - t0);
        statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      }
    }),
  );
  const seconds = (Date.now() - started) / 1000;
  const errors = Object.entries(statuses).filter(([code]) => !["200", "304"].includes(code));
  assert(errors.length === 0, `Unexpected statuses ${JSON.stringify(statuses)}`);
  assert(
    (statuses["304"] ?? 0) >= 1500,
    `Unchanged feed polls did not answer 304: ${JSON.stringify(statuses)} etag=${etag}`,
  );
  const p95 = Math.round(percentile(latencies, 0.95));
  const feedSqlStarted = performance.now();
  sql(`select public.public_event_safety_feed_command('public','${key}');`);
  const feedSqlMs = Math.round(performance.now() - feedSqlStarted);
  console.log(
    JSON.stringify({
      feedSqlMs,
      feedBytes: feedText.length,
      p50Ms: Math.round(percentile(latencies, 0.5)),
      p95Ms: p95,
      requests: jobs.length,
      requestsPerSecond: Math.round(jobs.length / seconds),
      seedMs,
      snapshotBuildMs: buildMs,
      snapshotBytes: snapshotText.length,
      snapshotGzipBytes: snapshotGzip,
      statuses,
    }),
  );
  assert(p95 < 2000, `p95 latency ${p95} ms is too high locally.`);
} finally {
  sql(`delete from public.events where title='${title}';
    delete from auth.users where email like 'load-${run}-%' or id='${owner}';
    alter table public.event_entitlements drop constraint event_entitlements_seller_limit_check;
    alter table public.event_entitlements add constraint event_entitlements_seller_limit_check
      check (seller_limit >= 0 and seller_limit <= 30);`);
}
