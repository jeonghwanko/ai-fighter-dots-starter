-- Unlisted fighters (2026-10-27): registered, playable and the owner's as before, only left out of the public lists — the roster list
-- (GET /roster, which ODDBOUT's community row and fighters page read) and ODDBOUT's registered-fighter cup ranking. GET /roster/:id still
-- serves the fighter, so a link to him keeps working. For fixtures such as the plugin review account's fighters, whose review needs them
-- registered and active. An operator sets it; moderation (af_moderate_fighter) is the way to take a fighter down.
alter table public.af_fighters add column listed boolean not null default true;
comment on column public.af_fighters.listed is 'False leaves a registered fighter out of the public roster list and cup ranking; GET /roster/:id still serves him.';
