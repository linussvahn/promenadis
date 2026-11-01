create schema if not exists app_private;

revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

create table if not exists app_private.feature_flags (
  key text not null,
  environment text not null check (environment in ('local', 'staging', 'production')),
  scope_type text not null default 'global' check (scope_type in ('global', 'event', 'account')),
  scope_id uuid,
  enabled boolean not null default false,
  owner text not null,
  rationale text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint feature_flags_scope_consistency check (
    (scope_type = 'global' and scope_id is null)
    or (scope_type <> 'global' and scope_id is not null)
  ),
  constraint feature_flags_expiry_window check (
    expires_at > created_at and expires_at <= created_at + interval '90 days'
  )
);

create unique index if not exists feature_flags_scope_key
on app_private.feature_flags (key, environment, scope_type, scope_id) nulls not distinct;

alter table app_private.feature_flags enable row level security;
alter table app_private.feature_flags force row level security;

revoke all on table app_private.feature_flags from public, anon, authenticated;
grant select, insert, update, delete on table app_private.feature_flags to service_role;

comment on schema app_private is
  'Server-only application state. Browser roles must not receive usage.';
comment on table app_private.feature_flags is
  'Expiring server-enforced capability configuration; protective commands are not flaggable.';
