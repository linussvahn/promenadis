// Local preview only: creates a synthetic, already-live public flea market
// with three sellers so the public pages and map can be tried by hand.
// Publication is set directly because walking routes (Milestone 4) still gate
// the real publish command. Synthetic data only; never run against a hosted
// project.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }),
);
if (!status.API_URL?.startsWith("http://127.0.0.1")) throw new Error("Local stack only.");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function sql(input) {
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
    ],
    { input, encoding: "utf8" },
  ).trim();
}

const people = ["owner", "books", "kids", "plants"];
const ids = {};
const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
for (const role of people) {
  const email = `demo-${role}@example.invalid`;
  const found = existing.users.find((user) => user.email === email);
  if (found) {
    ids[role] = found.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    ids[role] = data.user.id;
  }
}

const title = "Demo: Söders gårdsloppis";
const sellers = [
  [
    "books",
    "Bokbordet",
    18.0632,
    59.3121,
    "Deckare och kokböcker",
    "Över 200 böcker, mest pocket.",
    "5",
    "{vinyl,serier}",
    true,
  ],
  ["kids", "Barnhörnan", 18.0661, 59.3128, "Barnkläder 0–8 år", "", "2", "{}", null],
  [
    "plants",
    "Gröna fönstret",
    18.0684,
    59.3136,
    "Sticklingar",
    "Pelargoner och monstera.",
    "10",
    "{}",
    true,
  ],
];
const key = sql(`
delete from public.events where title = '${title}';
select public.create_scheduled_draft_event_command('${ids.owner}', null, 'Söders loppisgäng', '${title}',
  'Gårdsloppis i hela kvarteret. Syntetisk demodata.', 'Europe/Stockholm', 'public',
  now() + interval '3 hours', now() + interval '9 hours', gen_random_uuid());
select public.upsert_draft_event_boundary_command('${ids.owner}', (select id from public.events where title = '${title}'), null,
  'Södermalm', '{"type":"Polygon","coordinates":[[[18.0600,59.3100],[18.0720,59.3100],[18.0720,59.3160],[18.0600,59.3160],[18.0600,59.3100]]]}'::jsonb,
  gen_random_uuid());
update public.events set admission_mode = 'auto_inside' where title = '${title}';
${sellers
  .map(
    ([role, name, lng, lat, listing, description, category, tags, stepFree]) => `
select public.apply_to_event_command('${ids[role]}', (select id from public.events where title = '${title}'), '${name}',
  'Testgatan ${role.length}', '', '', ${lng}, ${lat}, 'manual', null, true, gen_random_uuid());
select public.save_seller_listing_command('${ids[role]}',
  (select p.id from public.seller_participations p join public.events e on e.id = p.event_id
   where p.account_id = '${ids[role]}' and e.title = '${title}'), 0,
  '${listing}', '${description}', array['0199a000-0000-7000-8000-0000000000${category.padStart(2, "0")}'::uuid],
  '${tags}', ${stepFree ?? "null"}, null, null, 'outdoor', null, false, '[]', '[]', gen_random_uuid());`,
  )
  .join("\n")}
update public.events set state = 'published' where title = '${title}';
update public.events set state = 'active' where title = '${title}';
select app_private.refresh_public_snapshots_command();
select public_key from public.events where title = '${title}';`)
  .split("\n")
  .at(-1);

console.log(`Demo event is live: http://127.0.0.1:5173/e/${key}`);
console.log(`Map: http://127.0.0.1:5173/e/${key}/map`);
console.log(
  "Sign in as demo-owner@example.invalid (codes arrive in Mailpit, http://127.0.0.1:54324).",
);
