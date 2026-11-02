-- Milestone 2, slice 3: versioned flea-market taxonomy, the event's enabled
-- subset and suggested tags, and the seller's text-only listing: title,
-- description, categories, tags, accessibility facts, highlighted items,
-- availability and live status. Public search and display arrive with
-- public discovery (Milestone 3).

create table public.taxonomy_versions (
  id uuid primary key,
  key text not null unique check (key ~ '^[a-z-]+-v[0-9]+$'),
  event_format text not null check (event_format in ('flea_market')),
  created_at timestamptz not null default clock_timestamp()
);

-- IDs are immutable and never reused; deprecation maps to a replacement.
create table public.taxonomy_categories (
  id uuid primary key,
  version_id uuid not null references public.taxonomy_versions (id),
  key text not null check (key ~ '^[a-z_]+$'),
  sort_order smallint not null,
  is_other boolean not null default false,
  deprecated_at timestamptz,
  replacement_category_id uuid references public.taxonomy_categories (id),
  unique (version_id, key)
);

create table public.taxonomy_category_localizations (
  category_id uuid not null references public.taxonomy_categories (id),
  locale text not null check (locale in ('sv', 'en')),
  label text not null check (char_length(label) between 1 and 60),
  description text not null check (char_length(description) <= 200),
  synonyms text[] not null default '{}',
  primary key (category_id, locale)
);

insert into public.taxonomy_versions (id, key, event_format)
values ('0199a000-0000-7000-8000-000000000100', 'flea-market-v1', 'flea_market');

insert into public.taxonomy_categories (id, version_id, key, sort_order, is_other)
select ('0199a000-0000-7000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '0199a000-0000-7000-8000-000000000100', key, n, key = 'other'
from (values
  (1, 'clothing_accessories'), (2, 'children_baby'), (3, 'home_kitchen'), (4, 'furniture_decor'),
  (5, 'books_media'), (6, 'toys_games'), (7, 'electronics'), (8, 'sports_outdoors'),
  (9, 'tools_diy'), (10, 'garden_plants'), (11, 'collectibles_vintage'), (12, 'crafts_handmade'),
  (13, 'food_refreshments'), (14, 'other')
) as category(n, key);

insert into public.taxonomy_category_localizations (category_id, locale, label, description, synonyms)
select c.id, l.locale, l.label, l.description, l.synonyms
from public.taxonomy_categories c
join (values
  ('clothing_accessories', 'sv', 'Kläder & accessoarer', 'Kläder, skor, väskor och smycken.', array['kläder','skor','väskor','smycken','jackor']),
  ('clothing_accessories', 'en', 'Clothing & accessories', 'Clothes, shoes, bags and jewellery.', array['clothes','shoes','bags','jewellery']),
  ('children_baby', 'sv', 'Barn & baby', 'Barnkläder, barnvagnar och babysaker.', array['barnkläder','barnvagn','baby']),
  ('children_baby', 'en', 'Children & baby', 'Children''s clothes, prams and baby items.', array['kids','pram','stroller']),
  ('home_kitchen', 'sv', 'Hem & kök', 'Porslin, glas, köksredskap och textil.', array['porslin','glas','köksredskap','textil']),
  ('home_kitchen', 'en', 'Home & kitchen', 'Tableware, glass, kitchen tools and textiles.', array['tableware','kitchenware','textiles']),
  ('furniture_decor', 'sv', 'Möbler & inredning', 'Möbler, lampor och dekoration.', array['möbler','lampor','tavlor']),
  ('furniture_decor', 'en', 'Furniture & decor', 'Furniture, lamps and decoration.', array['furniture','lamps','art']),
  ('books_media', 'sv', 'Böcker & media', 'Böcker, skivor, filmer och serier.', array['böcker','vinyl','skivor','filmer','serier']),
  ('books_media', 'en', 'Books & media', 'Books, records, films and comics.', array['books','vinyl','records','dvd','comics']),
  ('toys_games', 'sv', 'Leksaker & spel', 'Leksaker, pussel och sällskapsspel.', array['leksaker','lego','pussel','brädspel']),
  ('toys_games', 'en', 'Toys & games', 'Toys, puzzles and board games.', array['toys','lego','puzzles','board games']),
  ('electronics', 'sv', 'Elektronik', 'Elektronik, ljud, spelkonsoler och tillbehör.', array['elektronik','spelkonsol','hörlurar']),
  ('electronics', 'en', 'Electronics', 'Electronics, audio, consoles and accessories.', array['electronics','console','headphones']),
  ('sports_outdoors', 'sv', 'Sport & fritid', 'Sportutrustning, cyklar och friluftsliv.', array['sport','cykel','friluftsliv','skidor']),
  ('sports_outdoors', 'en', 'Sports & outdoors', 'Sports gear, bikes and outdoor equipment.', array['sports','bike','outdoor','skis']),
  ('tools_diy', 'sv', 'Verktyg & bygg', 'Verktyg och byggmaterial.', array['verktyg','byggmaterial']),
  ('tools_diy', 'en', 'Tools & DIY', 'Tools and building materials.', array['tools','hardware']),
  ('garden_plants', 'sv', 'Trädgård & växter', 'Växter, sticklingar och trädgårdssaker.', array['växter','sticklingar','krukor']),
  ('garden_plants', 'en', 'Garden & plants', 'Plants, cuttings and garden items.', array['plants','cuttings','pots']),
  ('collectibles_vintage', 'sv', 'Samlarobjekt & vintage', 'Samlarsaker, antikt och vintage.', array['samlarobjekt','antikt','vintage','retro']),
  ('collectibles_vintage', 'en', 'Collectibles & vintage', 'Collectibles, antiques and vintage.', array['collectibles','antiques','vintage','retro']),
  ('crafts_handmade', 'sv', 'Hantverk & handgjort', 'Handgjorda saker och hantverksmaterial.', array['hantverk','handgjort','garn']),
  ('crafts_handmade', 'en', 'Crafts & handmade', 'Handmade items and craft supplies.', array['crafts','handmade','yarn']),
  ('food_refreshments', 'sv', 'Mat & fika', 'Fika, bakverk och dryck.', array['fika','bullar','kaffe','saft']),
  ('food_refreshments', 'en', 'Food & refreshments', 'Coffee, pastries and drinks.', array['coffee','pastries','cake','drinks']),
  ('other', 'sv', 'Övrigt', 'Något annat – beskriv det i texten.', array[]::text[]),
  ('other', 'en', 'Other', 'Something else – describe it in the text.', array[]::text[])
) as l(key, locale, label, description, synonyms) on l.key = c.key;

-- The event's pinned version and enabled subset in its own order.
create table public.event_taxonomies (
  event_id uuid primary key references public.events (id) on delete cascade,
  taxonomy_version_id uuid not null references public.taxonomy_versions (id),
  enabled_category_ids uuid[] not null check (cardinality(enabled_category_ids) between 1 and 14),
  suggested_tags text[] not null default '{}' check (cardinality(suggested_tags) <= 12),
  version integer not null default 1 check (version > 0)
);

create function app_private.create_default_event_taxonomy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.event_taxonomies (event_id, taxonomy_version_id, enabled_category_ids)
  select new.id, v.id, array_agg(c.id order by c.sort_order)
  from public.taxonomy_versions v join public.taxonomy_categories c on c.version_id = v.id
  where v.key = 'flea-market-v1' and c.deprecated_at is null
  group by v.id
  on conflict do nothing;
  return new;
end;
$$;
create trigger events_create_default_taxonomy
after insert on public.events
for each row execute function app_private.create_default_event_taxonomy();
insert into public.event_taxonomies (event_id, taxonomy_version_id, enabled_category_ids)
select e.id, '0199a000-0000-7000-8000-000000000100',
  (select array_agg(id order by sort_order) from public.taxonomy_categories)
from public.events e;

create table public.seller_listings (
  participation_id uuid primary key references public.seller_participations (id) on delete cascade,
  title text check (title is null or (title = btrim(title) and char_length(title) between 1 and 80)),
  description text not null default '' check (char_length(description) <= 1000),
  step_free boolean,
  has_stairs boolean,
  has_elevator boolean,
  setting text check (setting is null or setting in ('indoor', 'outdoor', 'both')),
  stroller_friendly boolean,
  early_visibility_opt_out boolean not null default false,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.seller_category_assignments (
  participation_id uuid not null references public.seller_participations (id) on delete cascade,
  category_id uuid not null references public.taxonomy_categories (id),
  position smallint not null,
  primary key (participation_id, category_id)
);

create table public.seller_tags (
  participation_id uuid not null references public.seller_participations (id) on delete cascade,
  display text not null check (display = btrim(display) and char_length(display) between 1 and 60),
  normalized text not null,
  position smallint not null,
  primary key (participation_id, normalized)
);

create table public.highlighted_items (
  id uuid primary key default extensions.gen_random_uuid(),
  participation_id uuid not null references public.seller_participations (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  category_id uuid not null references public.taxonomy_categories (id),
  status text not null default 'available' check (status in ('available', 'sold')),
  price_minor integer check (price_minor is null or price_minor between 0 and 10000000),
  currency text not null default 'SEK' check (currency ~ '^[A-Z]{3}$'),
  position smallint not null
);

create table public.seller_availability (
  id uuid primary key default extensions.gen_random_uuid(),
  participation_id uuid not null references public.seller_participations (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at)
);

-- Optional live override; the scheduled status is otherwise derived.
create table public.seller_live_status (
  participation_id uuid primary key references public.seller_participations (id) on delete cascade,
  status text not null check (status in ('open', 'away', 'closed_early')),
  until timestamptz,
  set_by_account_id uuid references public.profiles (account_id) on delete set null,
  set_at timestamptz not null default clock_timestamp(),
  check (status = 'away' or until is null)
);

do $$
declare t text;
begin
  foreach t in array array['taxonomy_versions', 'taxonomy_categories', 'taxonomy_category_localizations',
    'event_taxonomies', 'seller_listings', 'seller_category_assignments', 'seller_tags', 'highlighted_items',
    'seller_availability', 'seller_live_status']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end;
$$;

-- Tags are user text: case/space-insensitive identity, no platform-looking
-- badges or typed accessibility/safety claims.
create function app_private.normalize_tag(p_value text)
returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

create function app_private.tag_is_reserved(p_normalized text)
returns boolean language sql immutable set search_path = '' as $$
  select p_normalized ~ '(verifi|officiell|official|promenadis|tillgänglig|accessib|rullstol|wheelchair|trappfri|step.?free|barnvagnsvänlig|stroller|säker|safe|godkänd|approved)';
$$;

create function app_private.event_taxonomy_summary(p_event_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'taxonomyKey', v.key,
    'version', t.version,
    'suggestedTags', to_jsonb(t.suggested_tags),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id, 'key', c.key, 'isOther', c.is_other,
          'enabled', c.id = any(t.enabled_category_ids),
          'label', jsonb_build_object('sv', sv.label, 'en', en.label))
        order by coalesce(array_position(t.enabled_category_ids, c.id), 100 + c.sort_order))
      from public.taxonomy_categories c
      join public.taxonomy_category_localizations sv on sv.category_id = c.id and sv.locale = 'sv'
      join public.taxonomy_category_localizations en on en.category_id = c.id and en.locale = 'en'
      where c.version_id = t.taxonomy_version_id and c.deprecated_at is null), '[]'::jsonb))
  from public.event_taxonomies t join public.taxonomy_versions v on v.id = t.taxonomy_version_id
  where t.event_id = p_event_id;
$$;

create function public.get_event_taxonomy_command(p_actor_id uuid, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.event_memberships where event_id = p_event_id and account_id = p_actor_id)
    and not exists (select 1 from public.seller_participations where event_id = p_event_id and account_id = p_actor_id)
    and not exists (select 1 from public.events where id = p_event_id and state not in ('archived'))
  then raise exception 'Event not found'; end if;
  return app_private.event_taxonomy_summary(p_event_id);
end;
$$;

create function public.save_event_taxonomy_command(
  p_actor_id uuid, p_event_id uuid, p_expected_version integer, p_enabled_category_ids uuid[],
  p_suggested_tags text[], p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  taxonomy public.event_taxonomies;
  cleaned_tags text[];
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot configure categories'; end if;
  perform 1 from public.events where id = p_event_id and state = 'draft' for update;
  if not found then raise exception 'Categories are pinned after publication'; end if;
  select * into taxonomy from public.event_taxonomies where event_id = p_event_id for update;
  if taxonomy.version is distinct from p_expected_version then raise exception 'Taxonomy version conflict'; end if;
  select coalesce(array_agg(btrim(tag) order by ordinality), '{}') into cleaned_tags
  from unnest(coalesce(p_suggested_tags, '{}')) with ordinality as t(tag, ordinality)
  where btrim(tag) <> '';
  if cardinality(coalesce(p_enabled_category_ids, '{}')) not between 1 and 14
    or (select count(distinct id) from unnest(p_enabled_category_ids) id) <> cardinality(p_enabled_category_ids)
    or exists (select 1 from unnest(p_enabled_category_ids) as wanted(category_id)
      where not exists (select 1 from public.taxonomy_categories c
        where c.id = wanted.category_id and c.version_id = taxonomy.taxonomy_version_id and c.deprecated_at is null))
    or cardinality(cleaned_tags) > 12
    or exists (select 1 from unnest(cleaned_tags) tag
      where char_length(tag) > 30 or app_private.tag_is_reserved(app_private.normalize_tag(tag)))
    or (select count(distinct app_private.normalize_tag(tag)) from unnest(cleaned_tags) tag) <> cardinality(cleaned_tags)
  then raise exception 'Invalid category settings'; end if;
  update public.event_taxonomies
  set enabled_category_ids = p_enabled_category_ids, suggested_tags = cleaned_tags, version = version + 1
  where event_id = p_event_id;
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.taxonomy_saved', 'event', p_event_id, p_event_id,
    jsonb_build_object('enabledCount', cardinality(p_enabled_category_ids), 'suggestedTagCount', cardinality(cleaned_tags)));
  return app_private.event_taxonomy_summary(p_event_id);
end;
$$;

create function app_private.seller_listing_summary(p_participation_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'version', coalesce(l.version, 0),
    'title', l.title,
    'description', coalesce(l.description, ''),
    'accessibility', jsonb_build_object('stepFree', l.step_free, 'stairs', l.has_stairs,
      'elevator', l.has_elevator, 'setting', l.setting, 'strollerFriendly', l.stroller_friendly),
    'earlyVisibilityOptOut', coalesce(l.early_visibility_opt_out, false),
    'categoryIds', coalesce((select jsonb_agg(category_id order by position)
      from public.seller_category_assignments where participation_id = p_participation_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(display order by position)
      from public.seller_tags where participation_id = p_participation_id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'categoryId', category_id,
        'status', status, 'priceMinor', price_minor, 'currency', currency) order by position)
      from public.highlighted_items where participation_id = p_participation_id), '[]'::jsonb),
    'availability', coalesce((select jsonb_agg(jsonb_build_object('startsAt', starts_at, 'endsAt', ends_at) order by starts_at)
      from public.seller_availability where participation_id = p_participation_id), '[]'::jsonb),
    'liveStatus', (select jsonb_build_object('status', s.status, 'until', s.until, 'setAt', s.set_at)
      from public.seller_live_status s where s.participation_id = p_participation_id))
  from (select p_participation_id as id) requested
  left join public.seller_listings l on l.participation_id = requested.id;
$$;

create function public.get_seller_listing_command(p_actor_id uuid, p_participation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare participation public.seller_participations;
begin
  select * into participation from public.seller_participations where id = p_participation_id;
  if participation.id is null or (participation.account_id <> p_actor_id and not exists (
    select 1 from public.event_memberships where event_id = participation.event_id and account_id = p_actor_id))
  then raise exception 'Participation not found'; end if;
  return app_private.seller_listing_summary(p_participation_id);
end;
$$;

-- Whole-listing save: replaces categories, tags, items and availability.
create function public.save_seller_listing_command(
  p_actor_id uuid, p_participation_id uuid, p_expected_version integer, p_title text, p_description text,
  p_category_ids uuid[], p_tags text[], p_step_free boolean, p_stairs boolean, p_elevator boolean,
  p_setting text, p_stroller_friendly boolean, p_early_visibility_opt_out boolean, p_items jsonb,
  p_availability jsonb, p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  participation public.seller_participations;
  event_row public.events;
  taxonomy public.event_taxonomies;
  current_version integer;
  cleaned_tags text[];
  item jsonb;
  item_position integer := 0;
  slot jsonb;
  event_start timestamptz;
  event_end timestamptz;
begin
  select * into participation from public.seller_participations
  where id = p_participation_id and account_id = p_actor_id for update;
  if participation.id is null then raise exception 'Participation not found'; end if;
  if participation.state in ('withdrawn', 'rejected', 'revoked') then raise exception 'Participation already closed'; end if;
  select * into event_row from public.events where id = participation.event_id;
  if event_row.state in ('ended', 'cancelled', 'archived') then raise exception 'Event is closed'; end if;
  select * into taxonomy from public.event_taxonomies where event_id = participation.event_id;
  select coalesce(version, 0) into current_version from public.seller_listings where participation_id = p_participation_id;
  if coalesce(current_version, 0) is distinct from p_expected_version then raise exception 'Listing version conflict'; end if;
  select min(starts_at), max(ends_at) into event_start, event_end
  from public.event_intervals where event_id = participation.event_id;

  select coalesce(array_agg(btrim(tag) order by ordinality), '{}') into cleaned_tags
  from unnest(coalesce(p_tags, '{}')) with ordinality as t(tag, ordinality) where btrim(tag) <> '';
  if (p_title is not null and char_length(btrim(p_title)) not between 1 and 80)
    or char_length(coalesce(p_description, '')) > 1000
    or cardinality(coalesce(p_category_ids, '{}')) not between 1 and 5
    or (select count(distinct id) from unnest(p_category_ids) id) <> cardinality(p_category_ids)
    or exists (select 1 from unnest(p_category_ids) id where not (id = any(taxonomy.enabled_category_ids)))
    or cardinality(cleaned_tags) > 10
    or exists (select 1 from unnest(cleaned_tags) tag
      where char_length(tag) > 60 or app_private.tag_is_reserved(app_private.normalize_tag(tag)))
    or (select count(distinct app_private.normalize_tag(tag)) from unnest(cleaned_tags) tag) <> cardinality(cleaned_tags)
    or (p_setting is not null and p_setting not in ('indoor', 'outdoor', 'both'))
    or jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 20
    or jsonb_typeof(coalesce(p_availability, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_availability, '[]'::jsonb)) > 10
  then raise exception 'Invalid listing'; end if;
  -- "Other" needs words describing what is sold.
  if exists (select 1 from public.taxonomy_categories where id = any(p_category_ids) and is_other)
    and char_length(btrim(coalesce(p_description, ''))) < 10
  then raise exception 'Describe what Other means'; end if;

  insert into public.seller_listings (participation_id, title, description, step_free, has_stairs, has_elevator,
    setting, stroller_friendly, early_visibility_opt_out)
  values (p_participation_id, nullif(btrim(coalesce(p_title, '')), ''), btrim(coalesce(p_description, '')),
    p_step_free, p_stairs, p_elevator, p_setting, p_stroller_friendly, coalesce(p_early_visibility_opt_out, false))
  on conflict (participation_id) do update set title = excluded.title, description = excluded.description,
    step_free = excluded.step_free, has_stairs = excluded.has_stairs, has_elevator = excluded.has_elevator,
    setting = excluded.setting, stroller_friendly = excluded.stroller_friendly,
    early_visibility_opt_out = excluded.early_visibility_opt_out,
    version = public.seller_listings.version + 1, updated_at = clock_timestamp();

  delete from public.seller_category_assignments where participation_id = p_participation_id;
  insert into public.seller_category_assignments (participation_id, category_id, position)
  select p_participation_id, c.category_id, c.ordinality from unnest(p_category_ids) with ordinality as c(category_id, ordinality);
  delete from public.seller_tags where participation_id = p_participation_id;
  insert into public.seller_tags (participation_id, display, normalized, position)
  select p_participation_id, tag, app_private.normalize_tag(tag), ordinality
  from unnest(cleaned_tags) with ordinality as t(tag, ordinality);

  delete from public.highlighted_items where participation_id = p_participation_id;
  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    item_position := item_position + 1;
    if char_length(btrim(coalesce(item->>'name', ''))) not between 1 and 80
      or not ((item->>'categoryId')::uuid = any(taxonomy.enabled_category_ids))
      or coalesce(item->>'status', 'available') not in ('available', 'sold')
      or (item->>'priceMinor' is not null and (item->>'priceMinor')::bigint not between 0 and 10000000)
    then raise exception 'Invalid listing'; end if;
    insert into public.highlighted_items (participation_id, name, category_id, status, price_minor, position)
    values (p_participation_id, btrim(item->>'name'), (item->>'categoryId')::uuid,
      coalesce(item->>'status', 'available'), (item->>'priceMinor')::integer, item_position);
  end loop;

  delete from public.seller_availability where participation_id = p_participation_id;
  for slot in select * from jsonb_array_elements(coalesce(p_availability, '[]'::jsonb)) loop
    if (slot->>'startsAt')::timestamptz < event_start or (slot->>'endsAt')::timestamptz > event_end
      or (slot->>'endsAt')::timestamptz <= (slot->>'startsAt')::timestamptz
    then raise exception 'Availability must be within the event'; end if;
    insert into public.seller_availability (participation_id, starts_at, ends_at)
    values (p_participation_id, (slot->>'startsAt')::timestamptz, (slot->>'endsAt')::timestamptz);
  end loop;
  if exists (select 1 from public.seller_availability a join public.seller_availability b
      on a.participation_id = b.participation_id and a.id < b.id
      and tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at)
    where a.participation_id = p_participation_id)
  then raise exception 'Availability must be within the event'; end if;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.listing_saved', 'seller_participation', p_participation_id,
    participation.event_id, jsonb_build_object('categoryCount', cardinality(p_category_ids),
      'tagCount', cardinality(cleaned_tags), 'itemCount', item_position));
  return app_private.seller_listing_summary(p_participation_id);
end;
$$;

-- Seller-scoped at a shared stop. The team may act on a seller's behalf only
-- with a reason. Live status exists only while the event is active.
create function public.set_seller_live_status_command(
  p_actor_id uuid, p_participation_id uuid, p_status text, p_until timestamptz, p_reason text,
  p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  participation public.seller_participations;
  on_behalf boolean;
begin
  select * into participation from public.seller_participations where id = p_participation_id for update;
  if participation.id is null then raise exception 'Participation not found'; end if;
  on_behalf := participation.account_id <> p_actor_id;
  if on_behalf and not exists (select 1 from public.event_memberships
    where event_id = participation.event_id and account_id = p_actor_id)
  then raise exception 'Participation not found'; end if;
  if on_behalf and char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Reason required';
  end if;
  if not exists (select 1 from public.events where id = participation.event_id and state = 'active') then
    raise exception 'Live status only during the event';
  end if;
  if participation.state <> 'approved' then raise exception 'Only approved sellers have a live status'; end if;
  if p_status not in ('open', 'away', 'closed_early')
    or (p_status = 'away' and p_until is not null and p_until <= clock_timestamp())
    or (p_status <> 'away' and p_until is not null)
  then raise exception 'Invalid live status'; end if;
  if exists (select 1 from public.seller_live_status where participation_id = p_participation_id
    and status = 'closed_early') and p_status <> 'closed_early' and not on_behalf
  then raise exception 'Closed for the day'; end if;
  insert into public.seller_live_status (participation_id, status, until, set_by_account_id)
  values (p_participation_id, p_status, p_until, p_actor_id)
  on conflict (participation_id) do update set status = excluded.status, until = excluded.until,
    set_by_account_id = excluded.set_by_account_id, set_at = clock_timestamp();
  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'seller.live_status', 'seller_participation', p_participation_id,
    participation.event_id, jsonb_build_object('status', p_status, 'onBehalf', on_behalf)
      || case when on_behalf then jsonb_build_object('reason', btrim(p_reason)) else '{}'::jsonb end);
  return app_private.seller_listing_summary(p_participation_id);
end;
$$;

-- Duplicates keep the prior compatible category selection and suggestions.
create or replace function public.duplicate_event_command(
  p_actor_id uuid, p_source_event_id uuid, p_organizer_profile_id uuid, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_correlation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  source public.events;
  new_event_id uuid;
begin
  if not exists (select 1 from public.event_memberships
    where event_id = p_source_event_id and account_id = p_actor_id and role in ('owner', 'co_host'))
  then raise exception 'Actor cannot duplicate this event'; end if;
  select * into source from public.events where id = p_source_event_id;

  new_event_id := public.create_scheduled_draft_event_command(
    p_actor_id, coalesce(p_organizer_profile_id, source.organizer_profile_id), '',
    p_title, source.description, source.timezone, source.visibility, p_starts_at, p_ends_at, p_correlation_id);
  update public.events set admission_mode = source.admission_mode where id = new_event_id;

  insert into public.event_boundaries (event_id, boundary, display_label, area_square_meters, span_meters)
  select new_event_id, boundary, display_label, area_square_meters, span_meters
  from public.event_boundaries where event_id = p_source_event_id;
  update public.event_taxonomies t
  set enabled_category_ids = s.enabled_category_ids, suggested_tags = s.suggested_tags
  from public.event_taxonomies s
  where t.event_id = new_event_id and s.event_id = p_source_event_id
    and s.taxonomy_version_id = t.taxonomy_version_id;

  insert into app_private.audit_events (correlation_id, actor_account_id, action, target_type, target_id, event_id, safe_summary)
  values (p_correlation_id, p_actor_id, 'event.duplicated', 'event', new_event_id, new_event_id,
    jsonb_build_object('sourceEventId', p_source_event_id,
      'boundaryCopied', exists (select 1 from public.event_boundaries where event_id = new_event_id)));
  return new_event_id;
end;
$$;

revoke all on function app_private.create_default_event_taxonomy() from public, anon, authenticated;
revoke all on function app_private.normalize_tag(text) from public, anon, authenticated;
revoke all on function app_private.tag_is_reserved(text) from public, anon, authenticated;
revoke all on function app_private.event_taxonomy_summary(uuid) from public, anon, authenticated;
revoke all on function app_private.seller_listing_summary(uuid) from public, anon, authenticated;
revoke all on function public.get_event_taxonomy_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_event_taxonomy_command(uuid, uuid, integer, uuid[], text[], uuid) from public, anon, authenticated;
revoke all on function public.get_seller_listing_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_seller_listing_command(uuid, uuid, integer, text, text, uuid[], text[], boolean, boolean, boolean, text, boolean, boolean, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.set_seller_live_status_command(uuid, uuid, text, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.get_event_taxonomy_command(uuid, uuid) to service_role;
grant execute on function public.save_event_taxonomy_command(uuid, uuid, integer, uuid[], text[], uuid) to service_role;
grant execute on function public.get_seller_listing_command(uuid, uuid) to service_role;
grant execute on function public.save_seller_listing_command(uuid, uuid, integer, text, text, uuid[], text[], boolean, boolean, boolean, text, boolean, boolean, jsonb, jsonb, uuid) to service_role;
grant execute on function public.set_seller_live_status_command(uuid, uuid, text, timestamptz, text, uuid) to service_role;
