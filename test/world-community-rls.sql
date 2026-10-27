-- Execute as an administrative connection. Every fixture is rolled back; no email is sent.
begin;
insert into auth.users(id) values('f0000000-0000-4000-8000-000000000001'),('f0000000-0000-4000-8000-000000000002');
insert into public.af_worlds(id,name,cover_path,published) values
 ('world-rls-a','RLS A','/art/test.webp',true),('world-rls-b','RLS B','/art/test.webp',true),('world-rls-private','Private','/art/test.webp',false);
set local role anon;
do $$ begin
 if public.af_world_overview('world-rls-private') is not null then raise exception 'private world leaked'; end if;
 begin insert into public.af_world_members(world_id,user_id,nickname) values('world-rls-a','f0000000-0000-4000-8000-000000000001','guest');
 raise exception 'anonymous join accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
select public.af_world_join('world-rls-a','멤버 A');
select public.af_world_join('world-rls-a','중복 가입');
do $$ begin
 if (select count(*) from public.af_world_members where world_id='world-rls-a')<>1 then raise exception 'join not idempotent'; end if;
 begin insert into public.af_world_posts(world_id,author_id,title,body) values('world-rls-a','f0000000-0000-4000-8000-000000000002','위조','다른 사람');
 raise exception 'author forged'; exception when insufficient_privilege then null; end;
 begin insert into public.af_world_posts(world_id,author_id,title,body,pinned) values('world-rls-a','f0000000-0000-4000-8000-000000000001','공지','권한 없음',true);
 raise exception 'member pinned'; exception when insufficient_privilege then null; end;
 begin insert into public.af_world_posts(world_id,author_id,title,body) values('world-rls-b','f0000000-0000-4000-8000-000000000001','다른 세계','가입 안 함');
 raise exception 'cross-world post accepted'; exception when insufficient_privilege then null; end;
end $$;
insert into public.af_world_posts(id,world_id,author_id,title,body) values('f1000000-0000-4000-8000-000000000001','world-rls-a','f0000000-0000-4000-8000-000000000001','첫 번째 글','실제 DB 검증');
reset role;
select set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
set local role authenticated;
do $$ begin
 if (select jsonb_array_length(public.af_world_feed('world-rls-a',0)))<>1 then raise exception 'second account cannot read post'; end if;
 begin insert into public.af_world_comments(world_id,post_id,author_id,body) values('world-rls-a','f1000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','가입 전');
 raise exception 'nonmember comment accepted'; exception when insufficient_privilege then null; end;
end $$;
select public.af_world_join('world-rls-a','멤버 B');
insert into public.af_world_comments(world_id,post_id,author_id,body) values('world-rls-a','f1000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','가입 후 댓글');
insert into public.af_world_reactions(world_id,post_id,user_id) values('world-rls-a','f1000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002');
do $$ begin
 if public.af_world_overview('world-rls-a')->>'memberCount'<>'2' then raise exception 'member count wrong'; end if;
 if public.af_world_feed('world-rls-a',0)->0->>'comment_count'<>'1' then raise exception 'comment missing'; end if;
 if public.af_world_feed('world-rls-a',0)->0->>'likes'<>'1' then raise exception 'reaction missing'; end if;
 if (select author_name from public.af_world_posts where id='f1000000-0000-4000-8000-000000000001')<>'멤버 A' then raise exception 'author name not bound to membership'; end if;
 delete from public.af_world_posts where id='f1000000-0000-4000-8000-000000000001';
 if not exists(select 1 from public.af_world_posts where id='f1000000-0000-4000-8000-000000000001') then raise exception 'another author deleted post'; end if;
end $$;
delete from public.af_world_members where world_id='world-rls-a' and user_id='f0000000-0000-4000-8000-000000000002';
do $$ begin
 begin insert into public.af_world_comments(world_id,post_id,author_id,body) values('world-rls-a','f1000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','탈퇴 후');
 raise exception 'departed member comment accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}',true);
set local role authenticated;
do $$ begin
 begin perform public.af_world_join('world-rls-a','익명 계정'); raise exception 'anonymous auth user joined'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: public reads, private world isolation, duplicate join, two accounts, author binding, cross-world/nonmember/anonymous rejection, reaction, leave, ownership; fixtures rolled back' as result;
