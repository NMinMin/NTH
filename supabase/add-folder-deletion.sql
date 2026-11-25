begin;

alter table public.videos
 drop constraint videos_folder_id_user_id_fkey,
 add constraint videos_folder_id_user_id_fkey
  foreign key (folder_id, user_id) references public.folders (id, user_id)
  on delete no action;

commit;
