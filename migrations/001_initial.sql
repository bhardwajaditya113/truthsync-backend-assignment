create table if not exists normalized_records (
  id bigint generated always as identity primary key,
  source text not null,
  external_id text not null,
  kind text not null check (kind in ('contact','transaction','event')),
  occurred_at timestamptz not null,
  source_updated_at timestamptz not null,
  name text,
  email text,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency char(3),
  source_status text,
  metadata jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  unique(source, external_id)
);

create index if not exists normalized_records_revenue_idx
  on normalized_records(occurred_at, source, source_status) where kind = 'transaction';

create table if not exists collected_statuses (
  source text not null,
  source_status text not null,
  primary key(source, source_status)
);

insert into collected_statuses(source, source_status) values
  ('stripe','succeeded'), ('hubspot','closedwon')
on conflict do nothing;

create table if not exists sync_state (
  source text primary key,
  cursor text,
  updated_at timestamptz not null default now()
);

create table if not exists sync_runs (
  id bigint generated always as identity primary key,
  source text not null,
  status text not null check(status in ('succeeded','failed')),
  mode text not null check(mode in ('incremental','full')),
  records_written integer not null default 0,
  error text,
  finished_at timestamptz not null default now()
);

-- The only revenue definition in the application. Both API views consume this function.
create or replace function revenue_by_period(
  from_at timestamptz,
  to_at timestamptz,
  bucket text default 'day'
)
returns table(period timestamptz, currency text, amount_minor bigint)
language sql stable as $$
  select date_trunc(bucket, r.occurred_at) as period,
         r.currency::text,
         sum(r.amount_minor)::bigint as amount_minor
  from normalized_records r
  join collected_statuses s
    on s.source = r.source and s.source_status = r.source_status
  where r.kind = 'transaction'
    and r.amount_minor is not null and r.currency is not null
    and r.occurred_at >= from_at and r.occurred_at < to_at
  group by 1, 2
  order by 1, 2
$$;
