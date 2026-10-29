-- One immutable notification per new review. Earlier reviews are deliberately not backfilled.
create table public.af_review_emails (
  review_id bigint primary key references public.af_access_reviews(id) on delete cascade,
  delivery_key uuid not null unique default gen_random_uuid(),
  recipient text check (char_length(recipient)<=320 and recipient !~ E'[\r\n]'),
  decision text not null check (decision in ('approved','declined')),
  event_at timestamptz not null,
  access_expires_at timestamptz,
  template_version integer not null default 1 check(template_version=1),
  sender text,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed','attention','cancelled')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  provider_id text,
  sent_at timestamptz,
  last_error text check (last_error in ('missing-email','provider-unavailable','provider-rejected','retry-window-expired')),
  created_at timestamptz not null default now()
);
alter table public.af_review_emails enable row level security;
revoke all on public.af_review_emails from public,anon,authenticated;
grant all on public.af_review_emails to service_role;
create policy af_review_emails_service on public.af_review_emails for all to service_role using(true) with check(true);
create index af_review_emails_due on public.af_review_emails(next_attempt_at,review_id) where status in ('pending','failed','sending');

create function public.af_enqueue_review_email() returns trigger
language plpgsql security invoker set search_path='' as $$
declare address text; decided_at timestamptz; expiry timestamptz;
begin
  select email into address from auth.users where id=new.owner_id;
  select updated_at into decided_at from public.af_access_requests where owner_id=new.owner_id;
  if new.decision='approved' then select expires_at into expiry from public.af_creators where owner_id=new.owner_id; end if;
  insert into public.af_review_emails(review_id,recipient,decision,event_at,access_expires_at,status,last_error)
  values(new.id,address,new.decision,decided_at,expiry,
    case when address is null or strpos(address,'@')=0 then 'attention' else 'pending' end,
    case when address is null or strpos(address,'@')=0 then 'missing-email' else null end);
  return new;
end $$;
revoke all on function public.af_enqueue_review_email() from public,anon,authenticated;
grant execute on function public.af_enqueue_review_email() to service_role;
create trigger af_review_email_enqueued after insert on public.af_access_reviews for each row execute function public.af_enqueue_review_email();

create function public.af_mail_claim(p_sender text,p_owner uuid default null,p_version timestamptz default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.af_review_emails; owner uuid;
begin
  if p_sender is null or char_length(p_sender)>200 or p_sender ~ E'[\r\n]' or strpos(p_sender,'@')=0 then raise exception 'invalid-sender'; end if;
  -- Do not replay an uncertain send after the provider's 24-hour deduplication window.
  update public.af_review_emails set status='attention',last_error=case when first_attempt_at<now()-interval '23 hours' then 'retry-window-expired' else 'provider-unavailable' end,lease_id=null,lease_until=null
    where status in ('pending','failed','sending') and (first_attempt_at<now()-interval '23 hours' or attempts>=8)
      and (lease_until is null or lease_until<now());
  update public.af_review_emails e set status='cancelled',lease_id=null,lease_until=null
    where status in ('pending','failed','sending') and (lease_until is null or lease_until<now()) and not exists(
      select 1 from public.af_access_reviews v join public.af_access_requests r on r.owner_id=v.owner_id
      where v.id=e.review_id and r.status=v.decision and not exists(select 1 from public.af_access_reviews newer where newer.owner_id=v.owner_id and newer.id>v.id));
  select e.* into job from public.af_review_emails e join public.af_access_reviews v on v.id=e.review_id
    where e.status in ('pending','failed','sending') and e.next_attempt_at<=now()
      and (e.lease_until is null or e.lease_until<now()) and e.attempts<8
      and (p_owner is null or (v.owner_id=p_owner and v.request_version=p_version))
    order by e.next_attempt_at,e.review_id for update of e skip locked limit 1;
  if not found then return null; end if;
  update public.af_review_emails set status='sending',sender=coalesce(sender,p_sender),attempts=attempts+1,
    first_attempt_at=coalesce(first_attempt_at,now()),lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes'
    where review_id=job.review_id returning * into job;
  select owner_id into owner from public.af_access_reviews where id=job.review_id;
  return jsonb_build_object('reviewId',job.review_id::text,'deliveryKey',job.delivery_key,'ownerId',owner,'recipient',job.recipient,
    'decision',job.decision,'eventAt',job.event_at,'expiresAt',job.access_expires_at,'templateVersion',job.template_version,
    'sender',job.sender,'lease',job.lease_id);
end $$;

create function public.af_mail_finish(p_review bigint,p_lease uuid,p_provider_id text default null,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if (p_provider_id is null)=(p_error is null) or (p_error is not null and p_error not in ('provider-unavailable','provider-rejected'))
    or (p_provider_id is not null and (char_length(p_provider_id)>200 or char_length(p_provider_id)=0)) then raise exception 'invalid-email-result'; end if;
  update public.af_review_emails set
    status=case when p_provider_id is not null then 'sent' when p_error='provider-rejected' or attempts>=8 then 'attention' else 'failed' end,
    provider_id=p_provider_id,sent_at=case when p_provider_id is not null then now() else null end,last_error=p_error,
    next_attempt_at=now()+least(3600,60*power(2,attempts)::integer)*interval '1 second',lease_id=null,lease_until=null
    where review_id=p_review and status='sending' and lease_id=p_lease and lease_until>now();
  return found;
end $$;

create function public.af_admin_retry_mail(p_actor uuid,p_owner uuid,p_version timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  update public.af_review_emails e set next_attempt_at=now(),status='failed',attempts=least(e.attempts,7)
    from public.af_access_reviews v,public.af_access_requests r
    where e.review_id=v.id and v.owner_id=p_owner and v.request_version=p_version and r.owner_id=v.owner_id and r.status=v.decision
      and (e.status in ('pending','failed') or (e.status='attention' and e.last_error in ('provider-unavailable','provider-rejected')))
      and (e.first_attempt_at is null or e.first_attempt_at>now()-interval '23 hours')
      and not exists(select 1 from public.af_access_reviews newer where newer.owner_id=v.owner_id and newer.id>v.id);
  return found;
end $$;

revoke all on function public.af_mail_claim(text,uuid,timestamptz),public.af_mail_finish(bigint,uuid,text,text),public.af_admin_retry_mail(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.af_mail_claim(text,uuid,timestamptz),public.af_mail_finish(bigint,uuid,text,text),public.af_admin_retry_mail(uuid,uuid,timestamptz) to service_role;

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
        'review', (select jsonb_build_object('decision',v.decision,'reason',v.reason,'createdAt',v.created_at,'version',v.request_version,
            'email',(select jsonb_build_object('status',e.status,'attempts',e.attempts,'sentAt',e.sent_at,'error',e.last_error)
              from public.af_review_emails e where e.review_id=v.id))
          from public.af_access_reviews v where v.owner_id=r.owner_id order by v.id desc limit 1)) as item
      from public.af_access_requests r join auth.users u on u.id=r.owner_id left join public.af_creators c on c.owner_id=r.owner_id
      where (p_status='all' or r.status=p_status) and (p_search='' or strpos(lower(coalesce(u.email,'') || ' ' || r.note),lower(p_search))>0)
      order by r.updated_at desc,r.owner_id limit 20 offset p_page*20
    ) page),'[]'::jsonb)) into result
  from public.af_access_requests r join auth.users u on u.id=r.owner_id
  where (p_status='all' or r.status=p_status) and (p_search='' or strpos(lower(coalesce(u.email,'') || ' ' || r.note),lower(p_search))>0);
  return result;
end $$;
