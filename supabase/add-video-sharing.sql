-- Run once in the SQL Editor of an existing NTH Video project.
alter table public.videos add column if not exists share_token text;
create unique index if not exists videos_share_token_unique
 on public.videos(share_token) where share_token is not null;

