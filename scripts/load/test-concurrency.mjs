import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// Races through separate database connections: capacity must never be
// exceeded and single-flight commands must admit exactly one caller.
const args = [
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
];
const sql = (input) => execFileSync("docker", args, { encoding: "utf8", input }).trim();
// Parallel sessions start inside one container exec: many simultaneous
// `docker exec` calls overwhelm the local Podman socket.
const attemptAll = (statements) => {
  const script = statements
    .map(
      (statement, i) =>
        `(echo ${Buffer.from(statement).toString("base64")} | base64 -d | psql -X -Atq -v ON_ERROR_STOP=1 -U postgres > /tmp/race_${i} 2>&1; echo $? > /tmp/race_${i}.rc) &`,
    )
    .concat(
      "wait",
      ...statements.map(
        (_, i) => `printf '%s|%s\\n' "$(cat /tmp/race_${i}.rc)" "$(head -n1 /tmp/race_${i})"`,
      ),
    )
    .join("\n");
  return execFileSync("docker", ["exec", "-i", "supabase_db_promenadis", "sh", "-s"], {
    encoding: "utf8",
    input: script,
  })
    .trim()
    .split("\n")
    .map((line) => {
      const [code, ...rest] = line.split("|");
      return code === "0" ? { ok: rest.join("|") } : { error: rest.join("|") };
    });
};
const run = randomUUID().slice(0, 8);
const title = `Race ${run}`;
const owner = randomUUID();
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  const eventId = sql(`
    insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values ('${owner}','race-owner-${run}@example.invalid',now(),now(),now());
    insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
      select gen_random_uuid(),'race-${run}-'||n||'@example.invalid',now(),now(),now() from generate_series(1,40) n;
    select public.create_scheduled_draft_event_command('${owner}',null,'Race owner','${title}','','Europe/Stockholm','public',
      now()+interval '3 days', now()+interval '3 days 4 hours', gen_random_uuid());
    select public.upsert_draft_event_boundary_command('${owner}',(select id from public.events where title='${title}'),null,'Area',
      '{"type":"Polygon","coordinates":[[[18.0600,59.3100],[18.0720,59.3100],[18.0720,59.3160],[18.0600,59.3160],[18.0600,59.3100]]]}'::jsonb,
      gen_random_uuid());
    update public.events set admission_mode='auto_inside' where title='${title}';
    select id from public.events where title='${title}';`)
    .split("\n")
    .at(-1);
  const sellers = sql(
    `select id from auth.users where email like 'race-${run}-%' order by email;`,
  ).split("\n");

  // 40 simultaneous applications for 30 places.
  const applications = attemptAll(
    sellers.map(
      (
        id,
        n,
      ) => `select public.apply_to_event_command('${id}','${eventId}','Seller ${n}','Racegatan ${n}','','',
        ${18.0605 + (n % 20) * 0.0005},${59.3103 + Math.floor(n / 20) * 0.0005},'manual',null,true,gen_random_uuid());`,
    ),
  );
  const failed = applications.filter((result) => result.error).map((result) => result.error);
  assert(
    failed.length === 0,
    `Applications failed under concurrency: ${JSON.stringify([...new Set(failed)])}`,
  );
  const states = Object.fromEntries(
    sql(
      `select state, count(*) from public.seller_participations where event_id='${eventId}' group by 1;`,
    )
      .split("\n")
      .map((line) => line.split("|")),
  );
  assert(
    states.approved === "30" && states.waitlisted === "10",
    `Capacity race broke the entitlement: ${JSON.stringify(states)}`,
  );

  // Five simultaneous exports: one active export per event.
  const exports = attemptAll(
    Array.from(
      { length: 5 },
      () =>
        `select public.request_event_export_command('${owner}','${eventId}','${"a".repeat(40)}',now(),gen_random_uuid());`,
    ),
  );
  assert(
    exports.filter((result) => result.ok).length === 1,
    `Export race admitted ${exports.filter((r) => r.ok).length}`,
  );

  // Three simultaneous walking-network builds: one runs.
  const builds = attemptAll(
    Array.from(
      { length: 3 },
      () =>
        `select public.start_routing_build_command('${owner}','${eventId}','${"b".repeat(64)}','{}'::jsonb,'race/1',gen_random_uuid());`,
    ),
  );
  assert(
    builds.filter((result) => result.ok).length === 1,
    `Build race admitted ${builds.filter((r) => r.ok).length}`,
  );

  // Ten simultaneous withdrawals then promotions keep the count at 30.
  const approved = sql(
    `select account_id||','||id from public.seller_participations where event_id='${eventId}' and state='approved' limit 10;`,
  ).split("\n");
  attemptAll(
    approved.map((pair) => {
      const [account, participation] = pair.split(",");
      return `select public.withdraw_participation_command('${account}','${participation}',
        (select version from public.seller_participations where id='${participation}'),gen_random_uuid());`;
    }),
  );
  const after = sql(
    `select count(*) from public.seller_participations where event_id='${eventId}' and state='approved';`,
  );
  assert(after === "30", `Promotion after withdrawals left ${after} approved.`);
  console.log(
    "Concurrency passed: 30 of 40 places, one export, one build, promotions kept capacity at 30.",
  );
} finally {
  sql(`delete from public.events where title='${title}';
    delete from auth.users where email like 'race-${run}-%' or id='${owner}';`);
}
