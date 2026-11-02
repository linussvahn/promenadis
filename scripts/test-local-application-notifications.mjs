import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { deliverApplicationBatch } from "./application-notification-delivery.mjs";
import { localApplicationDependencies } from "./deliver-local-application-notifications.mjs";

// Local SQL -> outbox -> worker -> Mailpit, with bounce suppression.
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
    { input, encoding: "utf8" },
  ).trim();
const run = randomUUID().slice(0, 8);
const owner = randomUUID();
const seller = randomUUID();
const sellerEmail = `notice-seller-${run}@example.invalid`;
const inviteEmail = `notice-invite-${run}@example.invalid`;
const title = `Notice fixture ${run}`;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const messages = async (email) => {
  const response = await fetch(
    `http://127.0.0.1:54324/api/v1/search?query=to:${encodeURIComponent(email)}`,
  );
  return (await response.json()).messages ?? [];
};
try {
  sql(`
    insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values
      ('${owner}','notice-owner-${run}@example.invalid',now(),now(),now()),('${seller}','${sellerEmail}',now(),now(),now());
    select public.create_scheduled_draft_event_command('${owner}',null,'Notice owner','${title}','','Europe/Stockholm','unlisted',
      now()+interval '2 days', now()+interval '2 days 4 hours', gen_random_uuid());
    select public.upsert_draft_event_boundary_command('${owner}',(select id from public.events where title='${title}'),null,'Area',
      '{"type":"Polygon","coordinates":[[[18.0600,59.3300],[18.0640,59.3300],[18.0640,59.3330],[18.0600,59.3330],[18.0600,59.3300]]]}'::jsonb,
      gen_random_uuid());
    select public.apply_to_event_command('${seller}',(select id from public.events where title='${title}'),'Seller','Testgatan 1','','',
      18.061,59.331,'manual',null,true,gen_random_uuid());
    select public.decide_seller_participation_command('${owner}',p.id,p.version,'approve',null,gen_random_uuid())
      from public.seller_participations p where p.account_id='${seller}';
    update public.events set admission_mode='invite_only' where title='${title}';
    select public.invite_seller_command('${owner}',(select id from public.events where title='${title}'),'${inviteEmail}',gen_random_uuid());
    select public.record_email_feedback_command('${inviteEmail}','bounce');`);
  const result = await deliverApplicationBatch(localApplicationDependencies());
  assert(
    result.accepted >= 1 && result.failed === 0,
    `Unexpected delivery result ${JSON.stringify(result)}`,
  );
  const received = await messages(sellerEmail);
  assert(received.length === 1, "The seller did not get exactly one notice.");
  assert(received[0].Subject === `Promenadis: ${title}`, "Unexpected subject.");
  assert((await messages(inviteEmail)).length === 0, "A bounced address was mailed.");
  assert(
    sql(`select cancel_reason from app_private.notification_outbox where template='seller_invited'
      and event_id=(select id from public.events where title='${title}');`) === "suppressed",
    "The suppressed job was not cancelled.",
  );
  const again = await deliverApplicationBatch(localApplicationDependencies());
  assert(again.accepted === 0, "A delivered notice was sent twice.");
  console.log(
    "Application notices passed: decision mailed once, bounced invitation suppressed, no replay.",
  );
} finally {
  sql(`delete from public.events where title='${title}';
    delete from app_private.email_suppressions where email_hash=app_private.email_hash('${inviteEmail}');
    delete from auth.users where id in ('${owner}','${seller}');`);
}
