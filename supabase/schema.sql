-- Run this once in the Supabase SQL editor before importing seed data.
create extension if not exists pgcrypto;

create table if not exists public.study_settings (
  id boolean primary key default true check (id),
  admin_code_hash text not null,
  created_at timestamptz not null default now()
);

-- This is a SHA-256 hash, not the administrator code itself.
insert into public.study_settings (id, admin_code_hash)
values (true, 'b1218fe6f170f361c23b01f0cb8d6bbd19840c18cd0f469bbccaec32b3a658e2')
on conflict (id) do nothing;

create table if not exists public.admin_sessions (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.scenes (
  scene_id text primary key check (scene_id ~ '^S[0-9]{3}$'),
  tier text not null check (tier in ('perfect', 'excellent')),
  reference_asset text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.scene_variants (
  id uuid primary key default gen_random_uuid(),
  scene_id text not null references public.scenes(scene_id) on delete cascade,
  method_name text not null,
  asset_file text not null unique,
  unique (scene_id, method_name)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  round_no smallint check (round_no between 1 and 50),
  group_no smallint check (group_no between 1 and 15),
  issue_order integer not null unique check (issue_order > 0),
  status text not null default 'available' check (status in ('available', 'claimed', 'completed')),
  note text,
  claimed_by uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((round_no is null) = (group_no is null))
);

create table if not exists public.assignment_scenes (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  scene_id text not null references public.scenes(scene_id),
  position smallint not null check (position between 1 and 10),
  primary key (assignment_id, scene_id),
  unique (assignment_id, position)
);

create table if not exists public.assignment_scene_variants (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  scene_id text not null,
  variant_id uuid not null references public.scene_variants(id),
  display_position smallint not null check (display_position between 1 and 5),
  foreign key (assignment_id, scene_id) references public.assignment_scenes(assignment_id, scene_id) on delete cascade,
  unique (assignment_id, scene_id, variant_id),
  unique (assignment_id, scene_id, display_position)
);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  participant_id uuid not null,
  attempt_no integer not null check (attempt_no > 0),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (assignment_id, attempt_no)
);

create table if not exists public.responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  scene_id text not null references public.scenes(scene_id),
  candidate_id uuid not null references public.assignment_scene_variants(id),
  rank smallint not null check (rank between 1 and 5),
  evaluated_at timestamptz not null default now(),
  unique (attempt_id, scene_id, candidate_id),
  unique (attempt_id, scene_id, rank)
);

create index if not exists assignments_available_order on public.assignments (issue_order) where status = 'available';
create index if not exists attempts_participant_active on public.attempts (participant_id, started_at desc) where submitted_at is null;
create index if not exists responses_attempt_scene on public.responses (attempt_id, scene_id);

create or replace function public.is_study_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_sessions
    where user_id = auth.uid()
  );
$$;

create or replace function public.authorize_admin(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_hash text;
begin
  select admin_code_hash into expected_hash from public.study_settings where id = true;
  if p_code is null
    or expected_hash is null
    or encode(extensions.digest(p_code, 'sha256'), 'hex') is distinct from expected_hash then
    return false;
  end if;

  insert into public.admin_sessions (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;
  return true;
end;
$$;

create or replace function public.admin_sign_out()
returns void
language sql
security definer
set search_path = public
as $$ delete from public.admin_sessions where user_id = auth.uid(); $$;

alter table public.study_settings enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.scenes enable row level security;
alter table public.scene_variants enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_scenes enable row level security;
alter table public.assignment_scene_variants enable row level security;
alter table public.attempts enable row level security;
alter table public.responses enable row level security;

create policy "admins manage scenes" on public.scenes for all to authenticated using (public.is_study_admin()) with check (public.is_study_admin());
create policy "admins manage variants" on public.scene_variants for all to authenticated using (public.is_study_admin()) with check (public.is_study_admin());
create policy "admins manage assignments" on public.assignments for all to authenticated using (public.is_study_admin()) with check (public.is_study_admin());
create policy "admins manage assignment scenes" on public.assignment_scenes for all to authenticated using (public.is_study_admin()) with check (public.is_study_admin());
create policy "admins manage assignment variants" on public.assignment_scene_variants for all to authenticated using (public.is_study_admin()) with check (public.is_study_admin());
create policy "admins manage attempts" on public.attempts for all to authenticated using (public.is_study_admin()) with check (public.is_study_admin());
create policy "admins manage responses" on public.responses for all to authenticated using (public.is_study_admin()) with check (public.is_study_admin());

create or replace function public.assignment_payload(p_assignment_id uuid, p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  if not exists (
    select 1
    from public.assignments a
    join public.attempts t on t.assignment_id = a.id
    where a.id = p_assignment_id
      and t.id = p_attempt_id
      and t.participant_id = auth.uid()
      and a.claimed_by = auth.uid()
      and a.status = 'claimed'
      and t.submitted_at is null
  ) then
    raise exception 'This assignment is not active for this browser.';
  end if;

  select jsonb_build_object(
    'assignment_id', a.id,
    'attempt_id', p_attempt_id,
    'code', a.code,
    'scenes', coalesce(jsonb_agg(jsonb_build_object(
      'scene_id', s.scene_id,
      'position', ass.position,
      'reference_asset', s.reference_asset,
      'candidates', (
        select jsonb_agg(jsonb_build_object(
          'id', asv.id,
          'asset_file', sv.asset_file,
          'rank', r.rank
        ) order by asv.display_position)
        from public.assignment_scene_variants asv
        join public.scene_variants sv on sv.id = asv.variant_id
        left join public.responses r on r.attempt_id = p_attempt_id and r.candidate_id = asv.id
        where asv.assignment_id = a.id and asv.scene_id = s.scene_id
      )
    ) order by ass.position), '[]'::jsonb)
  ) into payload
  from public.assignments a
  join public.assignment_scenes ass on ass.assignment_id = a.id
  join public.scenes s on s.scene_id = ass.scene_id
  where a.id = p_assignment_id
  group by a.id, a.code;

  return payload;
end;
$$;

create or replace function public.get_active_assignment()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  active_assignment uuid;
  active_attempt uuid;
begin
  select a.id, t.id into active_assignment, active_attempt
  from public.assignments a
  join public.attempts t on t.assignment_id = a.id
  where a.status = 'claimed'
    and a.claimed_by = auth.uid()
    and t.participant_id = auth.uid()
    and t.submitted_at is null
  order by t.started_at
  limit 1;

  if active_assignment is null then return null; end if;
  return public.assignment_payload(active_assignment, active_attempt);
end;
$$;

create or replace function public.claim_assignment()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_assignment public.assignments%rowtype;
  next_attempt uuid;
  next_attempt_no integer;
begin
  -- Resume before claiming: a browser can never hold two unfinished assignments.
  select a.* into next_assignment
  from public.assignments a
  join public.attempts t on t.assignment_id = a.id
  where a.status = 'claimed'
    and a.claimed_by = auth.uid()
    and t.participant_id = auth.uid()
    and t.submitted_at is null
  order by t.started_at
  limit 1;

  if found then
    select id into next_attempt from public.attempts where assignment_id = next_assignment.id and participant_id = auth.uid() and submitted_at is null order by started_at limit 1;
    return public.assignment_payload(next_assignment.id, next_attempt);
  end if;

  -- FOR UPDATE SKIP LOCKED makes concurrent Start clicks consume different rows.
  select * into next_assignment
  from public.assignments
  where status = 'available'
  order by issue_order
  for update skip locked
  limit 1;

  if not found then return null; end if;

  update public.assignments
  set status = 'claimed', claimed_by = auth.uid(), claimed_at = now(), completed_at = null
  where id = next_assignment.id;

  select coalesce(max(attempt_no), 0) + 1 into next_attempt_no
  from public.attempts
  where assignment_id = next_assignment.id;

  insert into public.attempts (assignment_id, participant_id, attempt_no)
  values (next_assignment.id, auth.uid(), next_attempt_no)
  returning id into next_attempt;

  return public.assignment_payload(next_assignment.id, next_attempt);
end;
$$;

create or replace function public.save_scene_response(p_assignment_id uuid, p_scene_id text, p_ranks jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_attempt uuid;
begin
  select t.id into active_attempt
  from public.attempts t
  join public.assignments a on a.id = t.assignment_id
  where a.id = p_assignment_id
    and a.status = 'claimed'
    and a.claimed_by = auth.uid()
    and t.participant_id = auth.uid()
    and t.submitted_at is null;

  if active_attempt is null then raise exception 'No active assignment for this browser.'; end if;
  if jsonb_typeof(p_ranks) <> 'array' or jsonb_array_length(p_ranks) <> 5 then raise exception 'Exactly five ranks are required.'; end if;
  if not exists (select 1 from public.assignment_scenes where assignment_id = p_assignment_id and scene_id = p_scene_id) then raise exception 'Scene is not part of this assignment.'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_ranks) value
    where (value->>'rank') !~ '^[1-5]$'
  ) then raise exception 'Ranks must be integers from 1 to 5.'; end if;

  if (select count(distinct value->>'candidate_id') from jsonb_array_elements(p_ranks) value) <> 5
    or (select count(distinct value->>'rank') from jsonb_array_elements(p_ranks) value) <> 5 then
    raise exception 'Each candidate and rank must be unique.';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_ranks) value
    join public.assignment_scene_variants asv on asv.id = (value->>'candidate_id')::uuid
    where asv.assignment_id = p_assignment_id and asv.scene_id = p_scene_id
  ) <> 5 then raise exception 'Candidates do not match this scene.'; end if;

  delete from public.responses where attempt_id = active_attempt and scene_id = p_scene_id;
  insert into public.responses (attempt_id, scene_id, candidate_id, rank)
  select active_attempt, p_scene_id, (value->>'candidate_id')::uuid, (value->>'rank')::smallint
  from jsonb_array_elements(p_ranks) value;
end;
$$;

create or replace function public.complete_attempt(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_attempt uuid;
begin
  select t.id into active_attempt
  from public.attempts t
  join public.assignments a on a.id = t.assignment_id
  where a.id = p_assignment_id
    and a.status = 'claimed'
    and a.claimed_by = auth.uid()
    and t.participant_id = auth.uid()
    and t.submitted_at is null;

  if active_attempt is null then raise exception 'No active assignment for this browser.'; end if;
  if (select count(*) from public.responses where attempt_id = active_attempt) <> 50 then raise exception 'All ten scenes must be ranked before submission.'; end if;
  if (select count(distinct scene_id) from public.responses where attempt_id = active_attempt) <> 10 then raise exception 'All ten scenes must be ranked before submission.'; end if;

  update public.attempts set submitted_at = now() where id = active_attempt;
  update public.assignments set status = 'completed', completed_at = now() where id = p_assignment_id;
end;
$$;

create or replace function public.admin_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.is_study_admin(); $$;

create or replace function public.admin_update_assignment(
  p_assignment_id uuid,
  p_note text,
  p_issue_order integer,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_status text;
begin
  if not public.is_study_admin() then raise exception 'Administrator access required.'; end if;
  select status into old_status from public.assignments where id = p_assignment_id for update;
  if old_status is null then raise exception 'Assignment not found.'; end if;
  if p_issue_order is null or p_issue_order < 1 then raise exception 'Issue order must be positive.'; end if;
  if p_status not in (old_status, 'available') then raise exception 'Only reopening an assignment is supported.'; end if;

  update public.assignments
  set note = p_note,
      issue_order = p_issue_order,
      status = p_status,
      claimed_by = case when p_status = 'available' then null else claimed_by end,
      claimed_at = case when p_status = 'available' then null else claimed_at end,
      completed_at = case when p_status = 'available' then null else completed_at end
  where id = p_assignment_id;
end;
$$;

create or replace function public.admin_create_assignment(p_scene_ids jsonb, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_assignment uuid;
  new_order integer;
begin
  if not public.is_study_admin() then raise exception 'Administrator access required.'; end if;
  if jsonb_typeof(p_scene_ids) <> 'array' or jsonb_array_length(p_scene_ids) <> 10 then raise exception 'Exactly ten scene IDs are required.'; end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_scene_ids) value) <> 10 then raise exception 'Scene IDs must be unique.'; end if;
  if (select count(*) from public.scenes where scene_id in (select value from jsonb_array_elements_text(p_scene_ids) value)) <> 10 then raise exception 'One or more scene IDs do not exist.'; end if;

  lock table public.assignments in share row exclusive mode;
  select coalesce(max(issue_order), 0) + 1 into new_order from public.assignments;
  insert into public.assignments (code, issue_order, note)
  values ('X-' || replace(gen_random_uuid()::text, '-', ''), new_order, p_note)
  returning id into new_assignment;

  insert into public.assignment_scenes (assignment_id, scene_id, position)
  select new_assignment, value, ordinal::smallint
  from jsonb_array_elements_text(p_scene_ids) with ordinality as input(value, ordinal);

  insert into public.assignment_scene_variants (assignment_id, scene_id, variant_id, display_position)
  select new_assignment, ass.scene_id, sv.id,
    row_number() over (partition by ass.scene_id order by random())::smallint
  from public.assignment_scenes ass
  join public.scene_variants sv on sv.scene_id = ass.scene_id
  where ass.assignment_id = new_assignment;

  return new_assignment;
end;
$$;

create or replace function public.admin_delete_attempt(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_assignment uuid;
begin
  if not public.is_study_admin() then raise exception 'Administrator access required.'; end if;
  select assignment_id into target_assignment from public.attempts where id = p_attempt_id;
  if target_assignment is null then raise exception 'Attempt not found.'; end if;
  delete from public.attempts where id = p_attempt_id;
  update public.assignments
  set status = 'available', claimed_by = null, claimed_at = null, completed_at = null
  where id = target_assignment and not exists (
    select 1 from public.attempts where assignment_id = target_assignment and submitted_at is null
  );
end;
$$;

create or replace function public.admin_delete_assignment(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_study_admin() then raise exception 'Administrator access required.'; end if;
  delete from public.assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found.'; end if;
end;
$$;

revoke all on function public.is_study_admin() from public;
revoke all on function public.assignment_payload(uuid, uuid) from public;
revoke all on function public.authorize_admin(text), public.admin_sign_out() from public;
grant execute on function public.is_study_admin() to authenticated;
grant execute on function public.get_active_assignment(), public.claim_assignment(), public.save_scene_response(uuid, text, jsonb), public.complete_attempt(uuid) to authenticated;
grant execute on function public.authorize_admin(text), public.admin_sign_out(), public.admin_session(), public.admin_update_assignment(uuid, text, integer, text), public.admin_create_assignment(jsonb, text), public.admin_delete_attempt(uuid), public.admin_delete_assignment(uuid) to authenticated;
grant select on public.assignments, public.attempts, public.responses, public.assignment_scene_variants, public.scene_variants to authenticated;

-- Needed only by the local bootstrap script, which authenticates with the secret key.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
