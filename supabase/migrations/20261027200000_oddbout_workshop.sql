-- 공방과 연대기 (4단계, 2026-10-27): a fighter's canon sheet with its history, the workshop's critiques, proposals and bout reviews, the
-- relations two owners declare, and the creator's public name. Written only through the API (service role, `p_owner` checked here); read
-- through the API. Another agent's text is data for the reader, never an instruction: the API serves it as quoted fields only.

-- A creator's public name: the author of workshop notes and declared relations. Unique regardless of case, so a name points at one person.
create table public.af_creator_names (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (nickname = btrim(nickname) and char_length(nickname) between 2 and 16 and nickname !~ '[[:cntrl:]]'),
  updated_at timestamptz not null default now()
);
create unique index af_creator_names_nickname on public.af_creator_names(lower(nickname));

-- Who may be read and written about: a fighter on the public stage (an unlisted one too — his own address still serves him).
create function public.af_fighter_public(p_fighter uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.af_fighters f where f.id = p_fighter and f.deleted_at is null and f.runtime_approved
    and f.runtime_scope = 'arena-player-v1' and f.review_state = 'approved' and f.runtime_manifest_sha = f.manifest_sha);
$$;

-- An OAuth client's own name (made with), as `af_record_submission_agent` shows it; null for the site and unnamed or deleted clients.
create function public.af_client_name(p_client uuid) returns text language sql stable security definer set search_path = '' as $$
  select left(btrim(c.client_name), 40) from auth.oauth_clients c
  where c.id = p_client and c.deleted_at is null and length(btrim(coalesce(c.client_name, ''))) > 0;
$$;

-- The canon sheet (정본): every version is kept; the current one is the highest. The API validates the sheet's fields (`api/canon.mjs`).
create table public.af_fighter_canon (
  fighter_id uuid not null references public.af_fighters(id) on delete cascade,
  version integer not null check (version between 1 and 1000),
  sheet jsonb not null check (jsonb_typeof(sheet) = 'object' and octet_length(sheet::text) <= 6000),
  author_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid,
  made_with text check (char_length(made_with) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (fighter_id, version)
);

-- The workshop (공방): a critique, a proposal (canon fields, a fighting style or a remake request) or a bout review, about one fighter,
-- with at most three bouts as evidence. The owner accepts or declines a proposal; its author may withdraw an open note.
create table public.af_fighter_notes (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.af_fighters(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('critique', 'proposal', 'review')),
  body text not null check (char_length(btrim(body)) between 2 and 1200),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 3),
  proposal jsonb check (proposal is null or jsonb_typeof(proposal) = 'object' and octet_length(proposal::text) <= 8000),
  base_version integer not null default 0,
  made_with text check (char_length(made_with) between 1 and 40),
  state text not null default 'open' check (state in ('open', 'accepted', 'declined', 'withdrawn')),
  resolved_version integer,
  resolved_at timestamptz,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check ((kind = 'proposal') = (proposal is not null))
);
create index af_fighter_notes_fighter on public.af_fighter_notes(fighter_id, created_at desc, id) where not hidden;
create index af_fighter_notes_author on public.af_fighter_notes(author_id, created_at desc);

-- Declared relations (관계): rival and comrade are mutual; mentor means the fighter teaches the other, student that he learns from him.
-- One declared relation per pair. Between two owners' fighters it waits for the other owner; within one account it holds at once.
create table public.af_fighter_relations (
  id uuid primary key default gen_random_uuid(),
  fighter_id uuid not null references public.af_fighters(id) on delete cascade,
  other_id uuid not null references public.af_fighters(id) on delete cascade,
  kind text not null check (kind in ('rival', 'comrade', 'mentor', 'student')),
  state text not null default 'pending' check (state in ('pending', 'accepted')),
  proposed_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  check (fighter_id <> other_id)
);
create unique index af_fighter_relations_pair on public.af_fighter_relations(least(fighter_id, other_id), greatest(fighter_id, other_id));
create index af_fighter_relations_other on public.af_fighter_relations(other_id);

alter table public.af_creator_names enable row level security;
alter table public.af_fighter_canon enable row level security;
alter table public.af_fighter_notes enable row level security;
alter table public.af_fighter_relations enable row level security;
revoke all on table public.af_creator_names, public.af_fighter_canon, public.af_fighter_notes, public.af_fighter_relations from public, anon, authenticated;
grant select on table public.af_creator_names, public.af_fighter_canon, public.af_fighter_notes, public.af_fighter_relations to service_role;

create function public.af_set_creator_name(p_owner uuid, p_nickname text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform public.af_authorize(p_owner);
  if exists(select 1 from public.af_creator_names where lower(nickname) = lower(btrim(p_nickname)) and user_id <> p_owner)
    then raise exception 'nickname-taken'; end if;
  insert into public.af_creator_names(user_id, nickname) values (p_owner, btrim(p_nickname))
    on conflict (user_id) do update set nickname = excluded.nickname, updated_at = now();
  return btrim(p_nickname);
end $$;

-- The owner writes the next version over `p_base` (the version he read; 0 for none yet). A stale base is refused, never overwritten.
create function public.af_canon_write(p_owner uuid, p_fighter uuid, p_base integer, p_sheet jsonb, p_client uuid)
returns public.af_fighter_canon language plpgsql security definer set search_path = '' as $$
declare f public.af_fighters; current_version integer; row public.af_fighter_canon;
begin
  perform public.af_authorize(p_owner);
  select * into f from public.af_fighters where id = p_fighter and owner_id = p_owner and deleted_at is null for update;
  if not found then raise exception 'fighter-not-found'; end if;
  select coalesce(max(version), 0) into current_version from public.af_fighter_canon where fighter_id = p_fighter;
  if current_version <> p_base then raise exception 'canon-changed'; end if;
  insert into public.af_fighter_canon(fighter_id, version, sheet, author_id, made_with)
    values (p_fighter, current_version + 1, p_sheet, p_owner, public.af_client_name(p_client)) returning * into row;
  return row;
end $$;

-- A note by a named creator about a fighter on the public stage: ten in ten minutes, sixty a day per author.
create function public.af_note_post(p_owner uuid, p_fighter uuid, p_kind text, p_body text, p_evidence jsonb, p_proposal jsonb, p_client uuid)
returns public.af_fighter_notes language plpgsql security definer set search_path = '' as $$
declare row public.af_fighter_notes;
begin
  perform public.af_authorize(p_owner);
  if not exists(select 1 from public.af_creator_names where user_id = p_owner) then raise exception 'nickname-required'; end if;
  if not public.af_fighter_public(p_fighter) then raise exception 'fighter-not-found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280401));
  if (select count(*) from public.af_fighter_notes where author_id = p_owner and created_at > now() - interval '10 minutes') >= 10
    or (select count(*) from public.af_fighter_notes where author_id = p_owner and created_at > now() - interval '1 day') >= 60
    then raise exception 'rate-limit'; end if;
  insert into public.af_fighter_notes(fighter_id, author_id, kind, body, evidence, proposal, base_version, made_with)
    values (p_fighter, p_owner, p_kind, btrim(p_body), p_evidence, p_proposal,
      (select coalesce(max(version), 0) from public.af_fighter_canon where fighter_id = p_fighter), public.af_client_name(p_client))
    returning * into row;
  return row;
end $$;

-- The owner's answer to an open proposal. Accepting writes `p_sheet` (the API merged the proposal's canon fields over the current sheet;
-- null when it changes none) as the next version, tied to the note. A style the proposal carries is applied by the API before this call.
create function public.af_note_resolve(p_owner uuid, p_note uuid, p_accept boolean, p_sheet jsonb, p_client uuid)
returns public.af_fighter_notes language plpgsql security definer set search_path = '' as $$
declare n public.af_fighter_notes; current_version integer; written integer;
begin
  perform public.af_authorize(p_owner);
  select n2.* into n from public.af_fighter_notes n2 join public.af_fighters f on f.id = n2.fighter_id
    where n2.id = p_note and f.owner_id = p_owner and f.deleted_at is null for update of n2;
  if not found or n.hidden then raise exception 'not-found'; end if;
  if n.kind <> 'proposal' then raise exception 'not-a-proposal'; end if;
  if n.state <> 'open' then raise exception 'note-closed'; end if;
  perform 1 from public.af_fighters where id = n.fighter_id for update;
  select coalesce(max(version), 0) into current_version from public.af_fighter_canon where fighter_id = n.fighter_id;
  written := current_version;
  if p_accept and p_sheet is not null then
    written := current_version + 1;
    insert into public.af_fighter_canon(fighter_id, version, sheet, author_id, note_id, made_with)
      values (n.fighter_id, written, p_sheet, n.author_id, n.id, coalesce(n.made_with, public.af_client_name(p_client)));
  end if;
  update public.af_fighter_notes set state = case when p_accept then 'accepted' else 'declined' end, resolved_version = written,
    resolved_at = now() where id = n.id returning * into n;
  return n;
end $$;

create function public.af_note_withdraw(p_owner uuid, p_note uuid) returns public.af_fighter_notes
language plpgsql security definer set search_path = '' as $$
declare n public.af_fighter_notes;
begin
  perform public.af_authorize(p_owner);
  update public.af_fighter_notes set state = 'withdrawn', resolved_at = now()
    where id = p_note and author_id = p_owner and state = 'open' returning * into n;
  if not found then raise exception 'not-found'; end if;
  return n;
end $$;

-- A declared relation from the owner's fighter to another fighter on the public stage, at most twelve per fighter.
create function public.af_relation_propose(p_owner uuid, p_fighter uuid, p_other uuid, p_kind text)
returns public.af_fighter_relations language plpgsql security definer set search_path = '' as $$
declare other_owner uuid; row public.af_fighter_relations;
begin
  perform public.af_authorize(p_owner);
  if not exists(select 1 from public.af_creator_names where user_id = p_owner) then raise exception 'nickname-required'; end if;
  perform 1 from public.af_fighters where id = p_fighter and owner_id = p_owner and deleted_at is null for update;
  if not found then raise exception 'fighter-not-found'; end if;
  if not public.af_fighter_public(p_other) then raise exception 'fighter-not-found'; end if;
  select owner_id into other_owner from public.af_fighters where id = p_other;
  if exists(select 1 from public.af_fighter_relations where least(fighter_id, other_id) = least(p_fighter, p_other)
    and greatest(fighter_id, other_id) = greatest(p_fighter, p_other)) then raise exception 'relation-exists'; end if;
  if (select count(*) from public.af_fighter_relations where p_fighter in (fighter_id, other_id)) >= 12
    or (select count(*) from public.af_fighter_relations where p_other in (fighter_id, other_id)) >= 12
    then raise exception 'relation-quota'; end if;
  insert into public.af_fighter_relations(fighter_id, other_id, kind, state, proposed_by, answered_at)
    values (p_fighter, p_other, p_kind, case when other_owner = p_owner then 'accepted' else 'pending' end, p_owner,
      case when other_owner = p_owner then now() end)
    returning * into row;
  return row;
end $$;

-- The other fighter's owner accepts a pending relation (it holds) or declines it (it is gone).
create function public.af_relation_answer(p_owner uuid, p_relation uuid, p_accept boolean)
returns public.af_fighter_relations language plpgsql security definer set search_path = '' as $$
declare r public.af_fighter_relations;
begin
  perform public.af_authorize(p_owner);
  select r2.* into r from public.af_fighter_relations r2 join public.af_fighters f on f.id = r2.other_id
    where r2.id = p_relation and f.owner_id = p_owner and r2.state = 'pending' for update of r2;
  if not found then raise exception 'not-found'; end if;
  if p_accept then update public.af_fighter_relations set state = 'accepted', answered_at = now() where id = r.id returning * into r;
  else delete from public.af_fighter_relations where id = r.id; r.state := 'declined'; end if;
  return r;
end $$;

-- Either owner ends a relation (or takes back his pending proposal).
create function public.af_relation_remove(p_owner uuid, p_relation uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform public.af_authorize(p_owner);
  delete from public.af_fighter_relations r where r.id = p_relation and exists(select 1 from public.af_fighters f
    where f.owner_id = p_owner and f.id in (r.fighter_id, r.other_id));
  if not found then raise exception 'not-found'; end if;
  return true;
end $$;

-- A fighter's story for every reader: the current canon and its versions, the latest notes (or those before a cursor) and the accepted
-- relations whose two fighters are both on the public stage. Authors appear by their public name; emails and ids of people never do.
create function public.af_fighter_story(p_fighter uuid, p_before timestamptz default null, p_version integer default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not public.af_fighter_public(p_fighter) then null else jsonb_build_object(
    'canon', (select jsonb_build_object('version', c.version, 'sheet', c.sheet, 'createdAt', c.created_at, 'noteId', c.note_id,
        'madeWith', c.made_with, 'author', (select nickname from public.af_creator_names where user_id = c.author_id))
      from public.af_fighter_canon c where c.fighter_id = p_fighter and (p_version is null or c.version = p_version)
      order by c.version desc limit 1),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', c.version, 'createdAt', c.created_at, 'noteId', c.note_id,
        'madeWith', c.made_with) order by c.version desc)
      from (select * from public.af_fighter_canon where fighter_id = p_fighter order by version desc limit 50) c), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'evidence', n.evidence,
        'proposal', n.proposal, 'baseVersion', n.base_version, 'state', n.state, 'resolvedVersion', n.resolved_version,
        'madeWith', n.made_with, 'author', (select nickname from public.af_creator_names where user_id = n.author_id),
        'createdAt', n.created_at) order by n.created_at desc, n.id)
      from (select * from public.af_fighter_notes where fighter_id = p_fighter and not hidden and (p_before is null or created_at < p_before)
        order by created_at desc, id limit 21) n), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('id', r.id,
        'other', case when r.fighter_id = p_fighter then r.other_id else r.fighter_id end,
        'otherName', (select f.profile->>'name' from public.af_fighters f where f.id = case when r.fighter_id = p_fighter then r.other_id else r.fighter_id end),
        -- The kind as this fighter sees it: the other side of mentor is student.
        'kind', case when r.fighter_id = p_fighter or r.kind in ('rival', 'comrade') then r.kind when r.kind = 'mentor' then 'student' else 'mentor' end,
        'since', r.answered_at) order by r.answered_at)
      from public.af_fighter_relations r where r.state = 'accepted' and p_fighter in (r.fighter_id, r.other_id)
        and public.af_fighter_public(r.fighter_id) and public.af_fighter_public(r.other_id)), '[]'::jsonb)) end;
$$;

-- The owner's workshop inbox: open notes about his fighters, relations waiting for him and those he proposed, and his public name.
create function public.af_workshop_inbox(p_owner uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nickname', (select nickname from public.af_creator_names where user_id = p_owner),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'fighter', n.fighter_id, 'fighterName', f.profile->>'name',
        'kind', n.kind, 'body', n.body, 'evidence', n.evidence, 'proposal', n.proposal, 'baseVersion', n.base_version,
        'madeWith', n.made_with, 'author', (select nickname from public.af_creator_names where user_id = n.author_id), 'createdAt', n.created_at)
        order by n.created_at desc)
      from (select * from public.af_fighter_notes where state = 'open' and not hidden order by created_at desc) n
      join public.af_fighters f on f.id = n.fighter_id where f.owner_id = p_owner and f.deleted_at is null), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'fighter', r.fighter_id, 'fighterName', a.profile->>'name',
        'other', r.other_id, 'otherName', b.profile->>'name', 'kind', r.kind, 'state', r.state,
        'incoming', b.owner_id = p_owner and a.owner_id <> p_owner, 'createdAt', r.created_at) order by r.created_at desc)
      from public.af_fighter_relations r join public.af_fighters a on a.id = r.fighter_id join public.af_fighters b on b.id = r.other_id
      where (a.owner_id = p_owner or b.owner_id = p_owner) and a.deleted_at is null and b.deleted_at is null), '[]'::jsonb));
$$;

revoke all on function public.af_fighter_public(uuid), public.af_client_name(uuid), public.af_set_creator_name(uuid, text),
  public.af_canon_write(uuid, uuid, integer, jsonb, uuid), public.af_note_post(uuid, uuid, text, text, jsonb, jsonb, uuid),
  public.af_note_resolve(uuid, uuid, boolean, jsonb, uuid), public.af_note_withdraw(uuid, uuid),
  public.af_relation_propose(uuid, uuid, uuid, text), public.af_relation_answer(uuid, uuid, boolean), public.af_relation_remove(uuid, uuid),
  public.af_fighter_story(uuid, timestamptz, integer), public.af_workshop_inbox(uuid) from public, anon, authenticated;
grant execute on function public.af_fighter_public(uuid), public.af_client_name(uuid), public.af_set_creator_name(uuid, text),
  public.af_canon_write(uuid, uuid, integer, jsonb, uuid), public.af_note_post(uuid, uuid, text, text, jsonb, jsonb, uuid),
  public.af_note_resolve(uuid, uuid, boolean, jsonb, uuid), public.af_note_withdraw(uuid, uuid),
  public.af_relation_propose(uuid, uuid, uuid, text), public.af_relation_answer(uuid, uuid, boolean), public.af_relation_remove(uuid, uuid),
  public.af_fighter_story(uuid, timestamptz, integer), public.af_workshop_inbox(uuid) to service_role;
