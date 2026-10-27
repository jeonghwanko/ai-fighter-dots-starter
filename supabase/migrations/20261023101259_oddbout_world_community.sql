-- One world, one lounge. No client may assign characters, pin posts, or forge authors.
create table public.af_worlds (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 600),
  tagline text not null default '', place text not null default '',
  cover_path text not null check (cover_path ~ '^/art/[a-zA-Z0-9/_-]+\.webp$'),
  published boolean not null default false, created_at timestamptz not null default now()
);
create table public.af_world_fighters (
  fighter_id uuid primary key references public.af_fighters(id) on delete cascade,
  world_id text not null references public.af_worlds(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  portrait_path text check (portrait_path ~ '^/art/[a-zA-Z0-9/_-]+\.webp$')
);
create index af_world_fighters_world on public.af_world_fighters(world_id);
create table public.af_world_members (
  world_id text not null references public.af_worlds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (nickname = btrim(nickname) and char_length(nickname) between 2 and 16),
  joined_at timestamptz not null default now(), primary key(world_id,user_id)
);
create index af_world_members_user on public.af_world_members(user_id);
create index af_world_members_page on public.af_world_members(world_id,joined_at,user_id);
create table public.af_world_posts (
  id uuid primary key default gen_random_uuid(), world_id text not null references public.af_worlds(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null, title text not null check (char_length(btrim(title)) between 2 and 80),
  body text not null check (char_length(btrim(body)) between 2 and 2000),
  pinned boolean not null default false, hidden boolean not null default false,
  image_path text check (image_path ~ '^/art/[a-zA-Z0-9/_-]+\.webp$'),
  created_at timestamptz not null default now(), unique(world_id,id)
);
create index af_world_posts_page on public.af_world_posts(world_id,pinned desc,created_at desc,id) where not hidden;
create index af_world_posts_author on public.af_world_posts(author_id,created_at desc);
create table public.af_world_comments (
  id uuid primary key default gen_random_uuid(), world_id text not null, post_id uuid not null,
  author_id uuid not null references auth.users(id) on delete cascade, author_name text not null,
  body text not null check (char_length(btrim(body)) between 1 and 1000), hidden boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key(world_id,post_id) references public.af_world_posts(world_id,id) on delete cascade
);
create index af_world_comments_page on public.af_world_comments(world_id,post_id,created_at,id);
create index af_world_comments_author on public.af_world_comments(author_id,created_at desc);
create table public.af_world_reactions (
  world_id text not null, post_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  primary key(post_id,user_id), foreign key(world_id,post_id) references public.af_world_posts(world_id,id) on delete cascade
);
create index af_world_reactions_user on public.af_world_reactions(user_id);
create index af_world_reactions_world_post on public.af_world_reactions(world_id,post_id);

alter table public.af_worlds enable row level security;
alter table public.af_world_fighters enable row level security;
alter table public.af_world_members enable row level security;
alter table public.af_world_posts enable row level security;
alter table public.af_world_comments enable row level security;
alter table public.af_world_reactions enable row level security;
revoke all on public.af_worlds,public.af_world_fighters,public.af_world_members,public.af_world_posts,public.af_world_comments,public.af_world_reactions from anon,authenticated;
grant select on public.af_worlds,public.af_world_fighters,public.af_world_members,public.af_world_posts,public.af_world_comments,public.af_world_reactions to anon,authenticated;
grant all on public.af_worlds,public.af_world_fighters,public.af_world_members,public.af_world_posts,public.af_world_comments,public.af_world_reactions to service_role;
grant insert(world_id,user_id,nickname),delete on public.af_world_members to authenticated;
grant insert(id,world_id,author_id,title,body),delete on public.af_world_posts to authenticated;
grant insert(id,world_id,post_id,author_id,body),delete on public.af_world_comments to authenticated;
grant insert(world_id,post_id,user_id),delete on public.af_world_reactions to authenticated;

create policy world_read on public.af_worlds for select to anon,authenticated using(published);
create policy world_fighter_read on public.af_world_fighters for select to anon,authenticated
  using(exists(select 1 from public.af_worlds w where w.id=world_id));
create policy world_member_read on public.af_world_members for select to anon,authenticated
  using(exists(select 1 from public.af_worlds w where w.id=world_id));
create policy world_member_join on public.af_world_members for insert to authenticated
  with check(user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
    and exists(select 1 from public.af_worlds w where w.id=world_id));
create policy world_member_leave on public.af_world_members for delete to authenticated using(user_id=(select auth.uid()));
create policy world_post_read on public.af_world_posts for select to anon,authenticated
  using(not hidden and exists(select 1 from public.af_worlds w where w.id=world_id));
create policy world_post_write on public.af_world_posts for insert to authenticated
  with check(author_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
    and exists(select 1 from public.af_world_members m where m.world_id=af_world_posts.world_id and m.user_id=(select auth.uid())));
create policy world_post_remove on public.af_world_posts for delete to authenticated using(author_id=(select auth.uid()));
create policy world_comment_read on public.af_world_comments for select to anon,authenticated
  using(not hidden and exists(select 1 from public.af_world_posts p where p.world_id=af_world_comments.world_id and p.id=post_id));
create policy world_comment_write on public.af_world_comments for insert to authenticated
  with check(author_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
    and exists(select 1 from public.af_world_members m where m.world_id=af_world_comments.world_id and m.user_id=(select auth.uid()))
    and exists(select 1 from public.af_world_posts p where p.world_id=af_world_comments.world_id and p.id=post_id));
create policy world_comment_remove on public.af_world_comments for delete to authenticated using(author_id=(select auth.uid()));
create policy world_reaction_read on public.af_world_reactions for select to anon,authenticated
  using(exists(select 1 from public.af_world_posts p where p.world_id=af_world_reactions.world_id and p.id=post_id));
create policy world_reaction_write on public.af_world_reactions for insert to authenticated
  with check(user_id=(select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false')='false'
    and exists(select 1 from public.af_world_members m where m.world_id=af_world_reactions.world_id and m.user_id=(select auth.uid()))
    and exists(select 1 from public.af_world_posts p where p.world_id=af_world_reactions.world_id and p.id=post_id));
create policy world_reaction_remove on public.af_world_reactions for delete to authenticated using(user_id=(select auth.uid()));

create function public.af_world_author() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.author_id is distinct from auth.uid() then raise exception 'world-author-mismatch' using errcode='42501'; end if;
  select nickname into new.author_name from public.af_world_members where world_id=new.world_id and user_id=auth.uid();
  if new.author_name is null then raise exception 'world-membership-required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,981));
  if tg_table_name='af_world_posts' then
    if (select count(*) from public.af_world_posts where author_id=auth.uid() and created_at>now()-interval '10 minutes')>=10
      then raise exception 'world-rate-limit'; end if;
  else
    if (select count(*) from public.af_world_comments where author_id=auth.uid() and created_at>now()-interval '1 minute')>=30
      then raise exception 'world-rate-limit'; end if;
  end if;
  new.body=btrim(new.body); return new;
end $$;
revoke all on function public.af_world_author() from public,anon,authenticated;
create trigger af_world_post_author before insert on public.af_world_posts for each row execute function public.af_world_author();
create trigger af_world_comment_author before insert on public.af_world_comments for each row execute function public.af_world_author();

create function public.af_world_join(p_world text,p_nickname text) returns void
language sql security invoker set search_path='' as $$
  insert into public.af_world_members(world_id,user_id,nickname) values(p_world,auth.uid(),btrim(p_nickname)) on conflict(world_id,user_id) do nothing;
$$;
revoke all on function public.af_world_join(text,text) from public,anon;
grant execute on function public.af_world_join(text,text) to authenticated;

-- Aggregates and public names only; emails and auth metadata never enter this API.
create function public.af_world_overview(p_world text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('world',to_jsonb(w),'memberCount',(select count(*) from public.af_world_members where world_id=w.id),
    'membership',(select to_jsonb(m) from public.af_world_members m where world_id=w.id and user_id=auth.uid()),
    'characters',coalesce((select jsonb_agg(to_jsonb(f)) from public.af_world_fighters f where world_id=w.id),'[]'::jsonb))
  from public.af_worlds w where w.id=p_world;
$$;
create function public.af_world_feed(p_world text,p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
    'likes',(select count(*) from public.af_world_reactions r where r.world_id=p.world_id and r.post_id=p.id),
    'reacted',exists(select 1 from public.af_world_reactions r where r.post_id=p.id and r.user_id=auth.uid()),
    'comment_count',(select count(*) from public.af_world_comments c where c.world_id=p.world_id and c.post_id=p.id)
  ) order by p.pinned desc,p.created_at desc,p.id),'[]'::jsonb)
  from (select * from public.af_world_posts where world_id=p_world order by pinned desc,created_at desc,id limit 21 offset greatest(0,least(p_offset,100000))) p;
$$;
revoke all on function public.af_world_overview(text),public.af_world_feed(text,integer) from public;
grant execute on function public.af_world_overview(text),public.af_world_feed(text,integer) to anon,authenticated;

insert into public.af_worlds(id,name,description,tagline,place,cover_path,published) values
 ('kkumssi','꿈씨패밀리','꿈돌이의 새로운 도전을 함께 보고, 응원하고, 이야기해요. 처음 만난 우리도 이곳에서는 한 팀이니까요.',
  E'같은 이야기를 좋아하는,\n우리들의 작은 우주.','대전에서 시작되는 이야기','/art/worlds/kkumssi-preview/cover.webp',true);
-- Character mappings are intentionally empty until the Kkumssi characters are registered.
