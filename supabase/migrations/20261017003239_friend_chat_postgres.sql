-- Server-only chat storage. Firebase UIDs are text, not Supabase Auth UUIDs.
create schema if not exists game_private;
revoke all on schema game_private from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='game_chat_backend') then
    create role game_chat_backend nologin;
  end if;
end $$;

create table game_private.friend_chat_threads (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  member_uids text[] not null check (array_length(member_uids,1)=2 and member_uids[1]<member_uids[2]),
  names jsonb not null default '{}' check (jsonb_typeof(names)='object'),
  unread jsonb not null default '{}' check (jsonb_typeof(unread)='object'),
  last_message_id text not null default '',
  last_text text not null default '' check (char_length(last_text)<=400),
  last_sender_uid text not null default '',
  updated_at bigint not null default 0 check (updated_at>=0)
);
create index friend_chat_threads_members_idx on game_private.friend_chat_threads using gin (member_uids);
create table game_private.friend_chat_messages (
  thread_id text not null references game_private.friend_chat_threads(id),
  id text not null check (char_length(id) between 1 and 512),
  sender_uid text not null check (sender_uid ~ '^[A-Za-z0-9_-]{1,128}$'),
  text text not null check (char_length(text) between 1 and 400),
  sent_at bigint not null check (sent_at>=0),
  primary key (thread_id,id)
);
create index friend_chat_messages_recent_idx on game_private.friend_chat_messages (thread_id,sent_at desc,id desc);
create table game_private.friend_chat_senders (
  uid text primary key check (uid ~ '^[A-Za-z0-9_-]{1,128}$'),
  last_sent_at bigint not null check (last_sent_at>=0)
);

alter table game_private.friend_chat_threads enable row level security;
alter table game_private.friend_chat_messages enable row level security;
alter table game_private.friend_chat_senders enable row level security;
revoke all on all tables in schema game_private from public, anon, authenticated;
grant usage on schema game_private to game_chat_backend;
grant select,insert,update on game_private.friend_chat_threads,game_private.friend_chat_messages,
  game_private.friend_chat_senders to game_chat_backend;
-- Render checks Firebase tokens and reciprocal friendship before invoking the store.
-- Only a dedicated server login granted this role may use these policies.
create policy backend_chat_threads on game_private.friend_chat_threads to game_chat_backend using (true) with check (true);
create policy backend_chat_messages on game_private.friend_chat_messages to game_chat_backend using (true) with check (true);
create policy backend_chat_senders on game_private.friend_chat_senders to game_chat_backend using (true) with check (true);
