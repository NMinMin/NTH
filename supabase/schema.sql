create table public.folders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 180),
 share_token text,
 created_at timestamptz not null default now(), unique(id,user_id)
);
create table public.videos (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 folder_id uuid,
 name text not null check (length(trim(name)) between 1 and 180),
 mime text not null, size bigint not null check(size>0),
 width integer, height integer, duration double precision,
 status text not null default 'uploading' check(status in ('uploading','ready','failed','deleting')),
 chunks jsonb not null default '[]',
 share_token text,
 created_at timestamptz not null default now(),
 foreign key(folder_id,user_id) references public.folders(id,user_id)
);
create unique index folders_share_token_unique on public.folders(share_token) where share_token is not null;
create unique index videos_share_token_unique on public.videos(share_token) where share_token is not null;
create index videos_owner_date on public.videos(user_id,created_at desc);
alter table public.folders enable row level security;
alter table public.videos enable row level security;
create policy folders_read on public.folders for select to authenticated using(auth.uid()=user_id);
create policy videos_read on public.videos for select to authenticated using(auth.uid()=user_id);
revoke all on public.videos,public.folders from anon;
revoke insert,update,delete on public.videos,public.folders from authenticated;
grant select on public.videos,public.folders to authenticated;

