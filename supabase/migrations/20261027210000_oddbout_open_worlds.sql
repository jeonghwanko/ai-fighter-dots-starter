-- Open worlds (4단계 공방과 연대기, 2026-10-27): anyone signed in opens a world (two per account, published at once, the operator may hide
-- it), names its factions (진영), and the owners of registered fighters place them in it. The world's owner removes fighters and raises
-- posts to canon (정사); other posts stay fan writing. Operator worlds (owner_id null, e.g. kkumssi) keep their service-managed cast.
-- Writes go through the API (service role, `p_owner` checked here) so the site and the cloud MCP share one path; the lounge's own posting,
-- comments and likes stay as they were (RLS).
alter table public.af_worlds add column owner_id uuid references auth.users(id) on delete set null,
  add column hidden boolean not null default false,
  add column factions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(factions) = 'array' and jsonb_array_length(factions) <= 8 and octet_length(factions::text) <= 4000);
create index af_worlds_owner on public.af_worlds(owner_id) where owner_id is not null;
alter table public.af_world_fighters add column faction text check (faction ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  add column placed_by uuid references auth.users(id) on delete set null, add column placed_at timestamptz not null default now();
alter table public.af_world_posts add column canon boolean not null default false;
create index af_world_posts_canon on public.af_world_posts(world_id, created_at, id) where canon and not hidden;

alter policy world_read on public.af_worlds using (published and not hidden);

-- The lounge's overview, now with the owner's public name, whether the reader owns the world, the factions and each character's faction.
create or replace function public.af_world_overview(p_world text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('world', to_jsonb(w) - 'owner_id' - 'hidden', 'memberCount', (select count(*) from public.af_world_members where world_id = w.id),
    'membership', (select to_jsonb(m) from public.af_world_members m where world_id = w.id and user_id = auth.uid()),
    'isOwner', w.owner_id is not null and w.owner_id = auth.uid(),
    'owner', (select nickname from public.af_world_members where world_id = w.id and user_id = w.owner_id),
    'characters', coalesce((select jsonb_agg(to_jsonb(f) - 'placed_by' order by f.placed_at) from public.af_world_fighters f where world_id = w.id), '[]'::jsonb))
  from public.af_worlds w where w.id = p_world;
$$;

-- The chronicle's canon (정사): the posts the world's owner raised, in story order.
create function public.af_world_chronicle(p_world text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'body', p.body, 'author', p.author_name,
      'image', p.image_path, 'createdAt', p.created_at) order by p.created_at, p.id), '[]'::jsonb)
  from (select * from public.af_world_posts where world_id = p_world and canon and not hidden order by created_at, id limit 100) p;
$$;
revoke all on function public.af_world_chronicle(text) from public;
grant execute on function public.af_world_chronicle(text) to anon, authenticated, service_role;

-- Every published world, newest first: what a reader picks from.
create function public.af_world_list() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'tagline', w.tagline, 'description', w.description, 'place', w.place,
      'cover', w.cover_path, 'factions', w.factions, 'operator', w.owner_id is null,
      'owner', (select nickname from public.af_world_members where world_id = w.id and user_id = w.owner_id),
      'members', (select count(*) from public.af_world_members where world_id = w.id),
      'fighters', (select count(*) from public.af_world_fighters where world_id = w.id), 'createdAt', w.created_at)
    order by w.created_at desc, w.id), '[]'::jsonb)
  from (select * from public.af_worlds where published and not hidden order by created_at desc, id limit 100) w;
$$;

-- A new world, its owner its first member under `p_nickname`, its cover one of the world covers the site ships (`p_cover`, checked by the
-- API). Two per account (a hidden one counts).
create function public.af_world_create(p_owner uuid, p_name text, p_tagline text, p_description text, p_place text, p_nickname text, p_cover text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare world_id text := 'w-' || substr(md5(gen_random_uuid()::text), 1, 10);
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280402));
  if (select count(*) from public.af_worlds where owner_id = p_owner) >= 2 then raise exception 'world-quota'; end if;
  insert into public.af_worlds(id, name, description, tagline, place, cover_path, published, owner_id)
    values (world_id, btrim(p_name), btrim(p_description), btrim(p_tagline), btrim(p_place), p_cover, true, p_owner);
  insert into public.af_world_members(world_id, user_id, nickname) values (world_id, p_owner, btrim(p_nickname));
  return public.af_world_list_one(world_id);
end $$;

create function public.af_world_list_one(p_world text) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id', w.id, 'name', w.name, 'tagline', w.tagline, 'description', w.description, 'place', w.place,
    'cover', w.cover_path, 'factions', w.factions, 'operator', w.owner_id is null, 'createdAt', w.created_at)
  from public.af_worlds w where w.id = p_world;
$$;

-- The owner edits his world: text fields and the cover present in `p_patch` and the faction list (a removed faction leaves its fighters unaffiliated).
create function public.af_world_update(p_owner uuid, p_world text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.af_worlds;
begin
  perform public.af_authorize(p_owner);
  select * into w from public.af_worlds where id = p_world and owner_id = p_owner and not hidden for update;
  if not found then raise exception 'not-found'; end if;
  update public.af_worlds set name = coalesce(btrim(p_patch->>'name'), name), tagline = coalesce(btrim(p_patch->>'tagline'), tagline),
    description = coalesce(btrim(p_patch->>'description'), description), place = coalesce(btrim(p_patch->>'place'), place), cover_path = coalesce(p_patch->>'cover', cover_path),
    factions = coalesce(p_patch->'factions', factions) where id = p_world;
  if p_patch ? 'factions' then
    update public.af_world_fighters f set faction = null where f.world_id = p_world and f.faction is not null
      and not exists(select 1 from jsonb_array_elements(p_patch->'factions') x where x->>'id' = f.faction);
  end if;
  return public.af_world_list_one(p_world);
end $$;

-- The owner of a registered fighter places him in a world someone opened (and a faction of it), moves him, or takes him out (`p_world` null).
create function public.af_world_place(p_owner uuid, p_fighter uuid, p_world text, p_faction text) returns jsonb
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
  select * into w from public.af_worlds where id = p_world and published and not hidden and owner_id is not null;
  if not found then raise exception 'world-not-found'; end if;
  if p_faction is not null and not exists(select 1 from jsonb_array_elements(w.factions) x where x->>'id' = p_faction)
    then raise exception 'faction-not-found'; end if;
  insert into public.af_world_fighters(fighter_id, world_id, name, faction, placed_by, placed_at)
    values (p_fighter, p_world, left(f.profile->>'name', 60), p_faction, p_owner, now())
    on conflict (fighter_id) do update set world_id = excluded.world_id, name = excluded.name, faction = excluded.faction,
      placed_by = excluded.placed_by, placed_at = now();
  return jsonb_build_object('fighter', p_fighter, 'world', p_world, 'faction', p_faction);
end $$;

-- The world's owner takes a fighter out of his world.
create function public.af_world_remove_fighter(p_owner uuid, p_world text, p_fighter uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform public.af_authorize(p_owner);
  delete from public.af_world_fighters f using public.af_worlds w
    where f.fighter_id = p_fighter and f.world_id = p_world and w.id = f.world_id and w.owner_id = p_owner;
  if not found then raise exception 'not-found'; end if;
  return true;
end $$;

-- The world's owner raises a post to canon (정사) or lowers it.
create function public.af_world_canon(p_owner uuid, p_world text, p_post uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform public.af_authorize(p_owner);
  update public.af_world_posts p set canon = p_on from public.af_worlds w
    where p.id = p_post and p.world_id = p_world and w.id = p.world_id and w.owner_id = p_owner and not p.hidden;
  if not found then raise exception 'not-found'; end if;
  return p_on;
end $$;

-- A post written for a member through the API (the cloud MCP): the lounge's own author check, name and rate limit apply as to the site's
-- posts — it runs as him. `p_nickname` joins him first when he is not a member yet. The world's owner may raise it to canon at once.
create function public.af_world_post_as(p_owner uuid, p_world text, p_id uuid, p_title text, p_body text, p_nickname text, p_canon boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.af_world_posts;
begin
  perform public.af_authorize(p_owner);
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

revoke all on function public.af_world_list(), public.af_world_list_one(text), public.af_world_create(uuid, text, text, text, text, text, text),
  public.af_world_update(uuid, text, jsonb), public.af_world_place(uuid, uuid, text, text), public.af_world_remove_fighter(uuid, text, uuid),
  public.af_world_canon(uuid, text, uuid, boolean), public.af_world_post_as(uuid, text, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.af_world_list(), public.af_world_list_one(text), public.af_world_create(uuid, text, text, text, text, text, text),
  public.af_world_update(uuid, text, jsonb), public.af_world_place(uuid, uuid, text, text), public.af_world_remove_fighter(uuid, text, uuid),
  public.af_world_canon(uuid, text, uuid, boolean), public.af_world_post_as(uuid, text, uuid, text, text, text, boolean) to service_role;
