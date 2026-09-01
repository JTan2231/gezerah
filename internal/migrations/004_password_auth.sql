do $$
begin
	if exists (select 1 from users) then
		raise exception 'password authentication migration requires an empty users table';
	end if;
end;
$$;

alter table users
	add column username text not null,
	add column normalized_username text not null,
	add column password_hash text not null,
	add column status text not null default 'active',
	add constraint users_username_shape check (
		username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
	),
	add constraint users_normalized_username_shape check (
		normalized_username = lower(username)
		and normalized_username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
	),
	add constraint users_normalized_username_unique unique (normalized_username),
	add constraint users_password_hash_argon2id check (
		password_hash ~ '^\$argon2id\$v=[0-9]+\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$'
	),
	add constraint users_status_valid check (status in ('active', 'disabled'));

create table auth_sessions (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references users (id) on delete cascade,
	token_hash text not null unique,
	created_at timestamptz not null default now(),
	last_seen_at timestamptz not null default now(),
	idle_expires_at timestamptz not null,
	absolute_expires_at timestamptz not null,
	revoked_at timestamptz,
	constraint auth_sessions_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
	constraint auth_sessions_expiry_ordered check (
		idle_expires_at > created_at
		and absolute_expires_at >= idle_expires_at
	),
	constraint auth_sessions_last_seen_ordered check (last_seen_at >= created_at)
);

create index auth_sessions_user_active_idx
	on auth_sessions (user_id, absolute_expires_at desc)
	where revoked_at is null;

create index auth_sessions_expiry_idx
	on auth_sessions (idle_expires_at, absolute_expires_at)
	where revoked_at is null;
