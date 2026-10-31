-- 보유 토큰 (2026-10-31, 사용자: "oddbout에서 내가 보유한 토큰을 보여주고, (회원가입하면) 50만 토큰을 보여주고, 차감 보유 토큰을 보여줘").
-- Design: game repo docs/Plan/2026-10-26-hosted-fighter-generation (보유 토큰). 사용자 결정:
--   1. The first free fighter (one per account) becomes a token balance: an account may ask ODDBOUT while its balance is above zero.
--   2. Every token the official host spends on his jobs is taken off, whatever the outcome (a safety refusal and our side's failure too).
--   3. Every account, old and new, starts at 500,000. Spending is counted from af_generation_usage, which exists from today.
-- A job under way goes on when the balance goes below zero; the next request is refused (`generation-quota`, the free fighter's code, so
-- a page from before reads it as before). An operator (`af_admins`) is never refused. Tokens a person's own PC or another person's host
-- spends are their subscription's, not counted. The operator raises an account's grant: `update public.af_creators set token_grant = …`.

alter table public.af_creators add column token_grant bigint not null default 500000 check (token_grant >= 0);
create index af_generation_usage_job on public.af_generation_usage(job_id);

-- His tokens: the grant (an account not made yet has the default), the official host's tokens on his jobs, and what is left (below zero
-- when a job outran it).
create function public.af_generation_balance(p_owner uuid) returns jsonb language sql stable security invoker set search_path = '' as $$
  with granted as (select coalesce((select c.token_grant from public.af_creators c where c.owner_id = p_owner), 500000)::bigint as n),
  spent as (select coalesce(sum(u.tokens), 0)::bigint as n from public.af_generation_usage u join public.af_generation_jobs j on j.id = u.job_id
    where j.owner_id = p_owner and u.host_id = public.af_generation_official())
  select jsonb_build_object('granted', g.n, 'spent', s.n, 'balance', g.n - s.n) from granted g, spent s;
$$;

-- One job's tokens on the official host so far.
create function public.af_generation_job_tokens(p_job uuid) returns bigint language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(u.tokens), 0)::bigint from public.af_generation_usage u where u.job_id = p_job and u.host_id = public.af_generation_official();
$$;

-- Restated whole from 20261030150000 with only its rule changed: no tokens left (`af_generation_balance`), never for an operator.
-- af_generation_check (20261030170000) calls it for a request that is not on his own PC, so the check itself is unchanged.
create or replace function public.af_generation_free_used(p_owner uuid) returns boolean language sql stable security invoker set search_path = '' as $$
  select not public.af_generation_is_admin(p_owner) and (public.af_generation_balance(p_owner)->>'balance')::bigint <= 0;
$$;

revoke all on function public.af_generation_balance(uuid), public.af_generation_job_tokens(uuid) from public, anon, authenticated;
grant execute on function public.af_generation_balance(uuid), public.af_generation_job_tokens(uuid) to service_role;
