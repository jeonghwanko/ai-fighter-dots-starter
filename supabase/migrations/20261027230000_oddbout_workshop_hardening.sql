-- 공방과 연대기 보강 (4단계 적대적 리뷰, 2026-10-27).
--
-- 1. Accepting a proposal merges its canon fields here, under the fighter's lock, over the sheet as it is now: two accepts at once, or an
--    accept beside the owner's own write, no longer drop the other's change (the API used to merge outside the lock). A merge that leaves no
--    field is refused (`canon-empty`), one over the sheet's size too (`invalid-canon`). Declining answers any open note: a critique or a review
--    is dismissed from the inbox that way. The API now applies a proposal's style after this, not before (a withdrawn note kept its style).
-- 2. Canon writes: thirty an hour per fighter (the thousand versions a fighter may keep were a loop's nine minutes). A proposer's account
--    erased leaves the versions he wrote on another's fighter (author null), not a hole in his history.
-- 3. Relations: only a fighter on the public stage proposes one; a relation with a deleted fighter no longer counts toward the twelve (they
--    stayed hidden and uncounted-for, so anyone could fill a fighter's twelve and delete his own); both fighters are locked, in id order.
-- 4. The inbox: the newest hundred open notes, each relation's kind as the other side sees it (`otherKind`), and the owner's own canon per
--    fighter (`canon`) — read even while a fighter is off the public stage, so his form never writes over a version it could not see.
-- 5. Worlds: a fighter on the public stage is placed (a removed one is not); a world holds two hundred; its cast shows a fighter by his
--    current name and only while approved; who placed a fighter is no column the public reads (it tied a fighter to his owner's account); the
--    operator's worlds lead the list; the chronicle keeps the newest hundred canon posts; a post sent again with its id is the same post.

alter table public.af_fighter_canon alter column author_id drop not null,
  drop constraint af_fighter_canon_author_id_fkey,
  add constraint af_fighter_canon_author_id_fkey foreign key (author_id) references auth.users(id) on delete set null;
create index af_fighter_canon_recent on public.af_fighter_canon(fighter_id, created_at desc);

-- Thirty canon versions an hour per fighter (the caller holds the fighter's lock).
create function public.af_canon_rate(p_fighter uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.af_fighter_canon where fighter_id = p_fighter and created_at > now() - interval '1 hour') >= 30
    then raise exception 'rate-limit'; end if;
end $$;

create or replace function public.af_canon_write(p_owner uuid, p_fighter uuid, p_base integer, p_sheet jsonb, p_client uuid)
returns public.af_fighter_canon language plpgsql security definer set search_path = '' as $$
declare f public.af_fighters; current_version integer; row public.af_fighter_canon;
begin
  perform public.af_authorize(p_owner);
  select * into f from public.af_fighters where id = p_fighter and owner_id = p_owner and deleted_at is null for update;
  if not found then raise exception 'fighter-not-found'; end if;
  select coalesce(max(version), 0) into current_version from public.af_fighter_canon where fighter_id = p_fighter;
  if current_version <> p_base then raise exception 'canon-changed'; end if;
  perform public.af_canon_rate(p_fighter);
  insert into public.af_fighter_canon(fighter_id, version, sheet, author_id, made_with)
    values (p_fighter, current_version + 1, p_sheet, p_owner, public.af_client_name(p_client)) returning * into row;
  return row;
end $$;

-- The owner's answer to an open note. Declining answers any kind (a critique or review is dismissed). Accepting is a proposal's: its canon
-- fields (`proposal.canon` — a value sets a field, null removes it) merged over the current sheet as the next version, tied to the note.
-- `p_sheet` is no longer read (the API merged it before; kept so the signature and an older API's calls stay valid).
create or replace function public.af_note_resolve(p_owner uuid, p_note uuid, p_accept boolean, p_sheet jsonb, p_client uuid)
returns public.af_fighter_notes language plpgsql security definer set search_path = '' as $$
declare n public.af_fighter_notes; current_version integer; written integer; current jsonb; merged jsonb;
begin
  perform public.af_authorize(p_owner);
  select n2.* into n from public.af_fighter_notes n2 join public.af_fighters f on f.id = n2.fighter_id
    where n2.id = p_note and f.owner_id = p_owner and f.deleted_at is null for update of n2;
  if not found or n.hidden then raise exception 'not-found'; end if;
  if p_accept and n.kind <> 'proposal' then raise exception 'not-a-proposal'; end if;
  if n.state <> 'open' then raise exception 'note-closed'; end if;
  perform 1 from public.af_fighters where id = n.fighter_id for update;
  select coalesce(max(version), 0) into current_version from public.af_fighter_canon where fighter_id = n.fighter_id;
  written := current_version;
  if p_accept and jsonb_typeof(n.proposal->'canon') = 'object' then
    select c.sheet into current from public.af_fighter_canon c where c.fighter_id = n.fighter_id and c.version = current_version;
    merged := (coalesce(current, '{}'::jsonb) || jsonb_strip_nulls(n.proposal->'canon'))
      - coalesce((select array_agg(k.key) from jsonb_each(n.proposal->'canon') k where jsonb_typeof(k.value) = 'null'), '{}'::text[]);
    if merged = '{}'::jsonb then raise exception 'canon-empty'; end if;
    if octet_length(merged::text) > 6000 then raise exception 'invalid-canon'; end if;
    if merged is distinct from current then
      perform public.af_canon_rate(n.fighter_id);
      written := current_version + 1;
      insert into public.af_fighter_canon(fighter_id, version, sheet, author_id, note_id, made_with)
        values (n.fighter_id, written, merged, n.author_id, n.id, coalesce(n.made_with, public.af_client_name(p_client)));
    end if;
  end if;
  update public.af_fighter_notes set state = case when p_accept then 'accepted' else 'declined' end, resolved_version = written,
    resolved_at = now() where id = n.id returning * into n;
  return n;
end $$;

create or replace function public.af_relation_propose(p_owner uuid, p_fighter uuid, p_other uuid, p_kind text)
returns public.af_fighter_relations language plpgsql security definer set search_path = '' as $$
declare other_owner uuid; row public.af_fighter_relations;
begin
  perform public.af_authorize(p_owner);
  if not exists(select 1 from public.af_creator_names where user_id = p_owner) then raise exception 'nickname-required'; end if;
  if not exists(select 1 from public.af_fighters where id = p_fighter and owner_id = p_owner and deleted_at is null)
    or not public.af_fighter_public(p_fighter) or not public.af_fighter_public(p_other) then raise exception 'fighter-not-found'; end if;
  perform 1 from public.af_fighters where id in (p_fighter, p_other) order by id for update;
  select owner_id into other_owner from public.af_fighters where id = p_other;
  if exists(select 1 from public.af_fighter_relations where least(fighter_id, other_id) = least(p_fighter, p_other)
    and greatest(fighter_id, other_id) = greatest(p_fighter, p_other)) then raise exception 'relation-exists'; end if;
  -- A relation counts while both its fighters are there (one deleted, it is shown nowhere and answers to no one).
  if (select count(*) from public.af_fighter_relations r join public.af_fighters a on a.id = r.fighter_id join public.af_fighters b on b.id = r.other_id
        where p_fighter in (r.fighter_id, r.other_id) and a.deleted_at is null and b.deleted_at is null) >= 12
    or (select count(*) from public.af_fighter_relations r join public.af_fighters a on a.id = r.fighter_id join public.af_fighters b on b.id = r.other_id
        where p_other in (r.fighter_id, r.other_id) and a.deleted_at is null and b.deleted_at is null) >= 12
    then raise exception 'relation-quota'; end if;
  insert into public.af_fighter_relations(fighter_id, other_id, kind, state, proposed_by, answered_at)
    values (p_fighter, p_other, p_kind, case when other_owner = p_owner then 'accepted' else 'pending' end, p_owner,
      case when other_owner = p_owner then now() end)
    returning * into row;
  return row;
end $$;

create or replace function public.af_workshop_inbox(p_owner uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nickname', (select nickname from public.af_creator_names where user_id = p_owner),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'fighter', n.fighter_id, 'fighterName', n.fighter_name,
        'kind', n.kind, 'body', n.body, 'evidence', n.evidence, 'proposal', n.proposal, 'baseVersion', n.base_version,
        'madeWith', n.made_with, 'author', (select nickname from public.af_creator_names where user_id = n.author_id), 'createdAt', n.created_at)
        order by n.created_at desc, n.id)
      from (select x.*, f.profile->>'name' as fighter_name from public.af_fighter_notes x join public.af_fighters f on f.id = x.fighter_id
        where x.state = 'open' and not x.hidden and f.owner_id = p_owner and f.deleted_at is null order by x.created_at desc, x.id limit 100) n), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'fighter', r.fighter_id, 'fighterName', a.profile->>'name',
        'other', r.other_id, 'otherName', b.profile->>'name', 'kind', r.kind,
        'otherKind', case when r.kind = 'mentor' then 'student' when r.kind = 'student' then 'mentor' else r.kind end, 'state', r.state,
        'incoming', b.owner_id = p_owner and a.owner_id <> p_owner, 'createdAt', r.created_at) order by r.created_at desc)
      from public.af_fighter_relations r join public.af_fighters a on a.id = r.fighter_id join public.af_fighters b on b.id = r.other_id
      where (a.owner_id = p_owner or b.owner_id = p_owner) and a.deleted_at is null and b.deleted_at is null), '[]'::jsonb),
    'canon', coalesce((select jsonb_object_agg(c.fighter_id, jsonb_build_object('version', c.version, 'sheet', c.sheet))
      from (select distinct on (k.fighter_id) k.fighter_id, k.version, k.sheet from public.af_fighter_canon k join public.af_fighters f on f.id = k.fighter_id
        where f.owner_id = p_owner and f.deleted_at is null order by k.fighter_id, k.version desc) c), '{}'::jsonb));
$$;

-- A post sent again with its id (an agent retrying) is the same post: its own author in its own world gets it back.
create or replace function public.af_world_post_as(p_owner uuid, p_world text, p_id uuid, p_title text, p_body text, p_nickname text, p_canon boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.af_world_posts;
begin
  perform public.af_authorize(p_owner);
  select * into p from public.af_world_posts where id = p_id;
  if found then
    if p.world_id <> p_world or p.author_id <> p_owner then raise exception 'post-exists'; end if;
    return jsonb_build_object('id', p.id, 'world', p.world_id, 'title', p.title, 'author', p.author_name, 'canon', p.canon, 'createdAt', p.created_at);
  end if;
  if not exists(select 1 from public.af_worlds where id = p_world and published and not hidden) then raise exception 'world-not-found'; end if;
  if p_canon and not exists(select 1 from public.af_worlds where id = p_world and owner_id = p_owner) then raise exception 'not-world-owner'; end if;
  if not exists(select 1 from public.af_world_members where world_id = p_world and user_id = p_owner) then
    if p_nickname is null then raise exception 'world-membership-required'; end if;
    insert into public.af_world_members(world_id, user_id, nickname) values (p_world, p_owner, btrim(p_nickname));
  end if;
  perform set_config('request.jwt.claim.sub', p_owner::text, true);
  insert into public.af_world_posts(id, world_id, author_id, title, body, canon) values (p_id, p_world, p_owner, btrim(p_title), p_body, p_canon)
    returning * into p;
  return jsonb_build_object('id', p.id, 'world', p.world_id, 'title', p.title, 'author', p.author_name, 'canon', p.canon, 'createdAt', p.created_at);
end $$;

create or replace function public.af_world_place(p_owner uuid, p_fighter uuid, p_world text, p_faction text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.af_fighters; w public.af_worlds;
begin
  perform public.af_authorize(p_owner);
  select * into f from public.af_fighters where id = p_fighter and owner_id = p_owner and deleted_at is null for update;
  if not found then raise exception 'fighter-not-found'; end if;
  -- An operator world's character (placed by the service) is not moved or taken out by his owner here.
  if exists(select 1 from public.af_world_fighters where fighter_id = p_fighter and placed_by is null) then raise exception 'world-locked'; end if;
  if p_world is null then
    delete from public.af_world_fighters where fighter_id = p_fighter;
    return jsonb_build_object('fighter', p_fighter, 'world', null);
  end if;
  -- Only a fighter on the public stage is placed (a removed or unapproved one is taken out, never put in).
  if not public.af_fighter_public(p_fighter) then raise exception 'fighter-not-found'; end if;
  select * into w from public.af_worlds where id = p_world and published and not hidden and owner_id is not null for update;
  if not found then raise exception 'world-not-found'; end if;
  if p_faction is not null and not exists(select 1 from jsonb_array_elements(w.factions) x where x->>'id' = p_faction)
    then raise exception 'faction-not-found'; end if;
  if (select count(*) from public.af_world_fighters where world_id = p_world and fighter_id <> p_fighter) >= 200 then raise exception 'world-full'; end if;
  insert into public.af_world_fighters(fighter_id, world_id, name, faction, placed_by, placed_at)
    values (p_fighter, p_world, left(f.profile->>'name', 60), p_faction, p_owner, now())
    on conflict (fighter_id) do update set world_id = excluded.world_id, name = excluded.name, faction = excluded.faction,
      placed_by = excluded.placed_by, placed_at = now();
  return jsonb_build_object('fighter', p_fighter, 'world', p_world, 'faction', p_faction);
end $$;

-- The lounge's overview reads the cast itself now (the public no longer reads who placed a fighter): a published, unhidden world only; each
-- fighter by his current name, while he is approved and not deleted.
create or replace function public.af_world_overview(p_world text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('world', to_jsonb(w) - 'owner_id' - 'hidden', 'memberCount', (select count(*) from public.af_world_members where world_id = w.id),
    'membership', (select to_jsonb(m) from public.af_world_members m where world_id = w.id and user_id = auth.uid()),
    'isOwner', w.owner_id is not null and w.owner_id = auth.uid(),
    'owner', (select nickname from public.af_world_members where world_id = w.id and user_id = w.owner_id),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('fighter_id', c.fighter_id, 'world_id', c.world_id,
        'name', coalesce(left(nullif(btrim(f.profile->>'name'), ''), 60), c.name), 'portrait_path', c.portrait_path, 'faction', c.faction,
        'placed_at', c.placed_at) order by c.placed_at)
      from public.af_world_fighters c join public.af_fighters f on f.id = c.fighter_id
      where c.world_id = w.id and f.deleted_at is null and f.review_state = 'approved'), '[]'::jsonb))
  from public.af_worlds w where w.id = p_world and w.published and not w.hidden;
$$;
revoke all on function public.af_world_overview(text) from public;
grant execute on function public.af_world_overview(text) to anon, authenticated, service_role;

revoke select on public.af_world_fighters from anon, authenticated;
grant select (fighter_id, world_id, name, portrait_path, faction, placed_at) on public.af_world_fighters to anon, authenticated;

-- Every published world, the operator's first, then the newest: what a reader picks from (a hundred; the cast counted as the overview shows it).
create or replace function public.af_world_list() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'tagline', w.tagline, 'description', w.description, 'place', w.place,
      'cover', w.cover_path, 'factions', w.factions, 'operator', w.owner_id is null,
      'owner', (select nickname from public.af_world_members where world_id = w.id and user_id = w.owner_id),
      'members', (select count(*) from public.af_world_members where world_id = w.id),
      'fighters', (select count(*) from public.af_world_fighters c join public.af_fighters f on f.id = c.fighter_id
        where c.world_id = w.id and f.deleted_at is null and f.review_state = 'approved'), 'createdAt', w.created_at)
    order by w.owner_id is null desc, w.created_at desc, w.id), '[]'::jsonb)
  from (select * from public.af_worlds where published and not hidden order by owner_id is null desc, created_at desc, id limit 100) w;
$$;

-- The chronicle's canon (정사): the newest hundred posts the world's owner raised, in story order.
create or replace function public.af_world_chronicle(p_world text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'body', p.body, 'author', p.author_name,
      'image', p.image_path, 'createdAt', p.created_at) order by p.created_at, p.id), '[]'::jsonb)
  from (select * from public.af_world_posts where world_id = p_world and canon and not hidden order by created_at desc, id desc limit 100) p;
$$;

revoke all on function public.af_canon_rate(uuid) from public, anon, authenticated;
grant execute on function public.af_canon_rate(uuid) to service_role;
