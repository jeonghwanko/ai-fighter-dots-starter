-- Contact support replaces the unconfigured automatic review mail feature.
-- Preserve historical schema/data, stop new enqueueing and scheduled dispatch.
drop trigger if exists af_review_email_enqueued on public.af_access_reviews;
update public.af_review_emails set status='cancelled',lease_id=null,lease_until=null
where status in ('pending','failed','sending');
do $$ declare job record; begin
  if to_regclass('cron.job') is not null then
    for job in select jobid from cron.job where jobname='ai-fighter-review-emails' loop
      perform cron.alter_job(job.jobid,active:=false);
    end loop;
  end if;
end $$;

create or replace function public.af_admin_requests(p_actor uuid, p_status text default 'pending', p_search text default '', p_page integer default 0)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_status not in ('pending','approved','declined','all') or p_status is null or p_page is null or p_page < 0 or p_page > 10000
    or p_search is null or char_length(p_search)>200 then raise exception 'invalid-query'; end if;
  select jsonb_build_object(
    'counts', (select jsonb_build_object('pending',count(*) filter(where status='pending'),
      'approved',count(*) filter(where status='approved'),'declined',count(*) filter(where status='declined')) from public.af_access_requests),
    'activeCreators',(select count(*) from public.af_creators where enabled and expires_at>now()),
    'capacity',20,
    'total',count(*),
    'applications',coalesce((select jsonb_agg(item order by updated_at desc,owner_id) from (
      select r.updated_at,r.owner_id,jsonb_build_object('ownerId',r.owner_id,'email',u.email,'note',r.note,'status',r.status,
        'createdAt',r.created_at,'updatedAt',r.updated_at,
        'invited',coalesce(c.enabled and c.expires_at>now(),false),'expiresAt',c.expires_at,
        'review', (select jsonb_build_object('decision',v.decision,'reason',v.reason,'createdAt',v.created_at)
          from public.af_access_reviews v where v.owner_id=r.owner_id order by v.id desc limit 1)) as item
      from public.af_access_requests r join auth.users u on u.id=r.owner_id left join public.af_creators c on c.owner_id=r.owner_id
      where (p_status='all' or r.status=p_status) and (p_search='' or strpos(lower(coalesce(u.email,'') || ' ' || r.note),lower(p_search))>0)
      order by r.updated_at desc,r.owner_id limit 20 offset p_page*20
    ) page),'[]'::jsonb)) into result
  from public.af_access_requests r join auth.users u on u.id=r.owner_id
  where (p_status='all' or r.status=p_status) and (p_search='' or strpos(lower(coalesce(u.email,'') || ' ' || r.note),lower(p_search))>0);
  return result;
end $$;
