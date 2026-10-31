-- UTC로 통일 (2026-10-31, 사용자: "시간을 사용하는 것은 UTC 시간을 사용하게 전부 통일해줘"): the official host's day of tokens
-- (20261031120000) began at midnight in Korea; it now begins at 00:00 UTC (09:00 in Korea), like the duel budget's day. Every reader —
-- af_generation_tokens_today, a waiting job's queue.resetsAt and af_generation_capabilities' usage.resetsAt — goes through this function.

create or replace function public.af_generation_day_start() returns timestamptz language sql stable set search_path = '' as $$
  select date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;
