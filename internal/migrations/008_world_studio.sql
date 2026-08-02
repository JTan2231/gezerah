create table world_profiles (
	rule_set_id uuid primary key,
	primary_game_id uuid not null unique,
	status text not null default 'active',
	revision bigint not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_profiles_status_valid check (status in ('active', 'archived')),
	constraint world_profiles_revision_nonnegative check (revision >= 0),
	constraint world_profiles_rule_set_fk
		foreign key (rule_set_id) references rule_sets (id) on delete cascade,
	constraint world_profiles_primary_game_fk
		foreign key (primary_game_id, rule_set_id)
		references games (id, rule_set_id) on delete restrict
);

create trigger world_profiles_set_updated_at
before update on world_profiles
for each row execute function set_updated_at();

create table world_memberships (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	user_id uuid not null,
	role text not null,
	status text not null default 'active',
	revision bigint not null default 0,
	joined_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_memberships_role_valid
		check (role in ('owner', 'editor', 'player', 'spectator')),
	constraint world_memberships_status_valid check (status in ('active', 'left')),
	constraint world_memberships_revision_nonnegative check (revision >= 0),
	constraint world_memberships_joined_shape
		check (status <> 'active' or joined_at is not null),
	constraint world_memberships_world_user_unique unique (rule_set_id, user_id),
	constraint world_memberships_id_world_unique unique (id, rule_set_id),
	constraint world_memberships_world_fk
		foreign key (rule_set_id) references world_profiles (rule_set_id) on delete cascade,
	constraint world_memberships_user_fk
		foreign key (user_id) references users (id) on delete restrict
);

create index world_memberships_user_idx
	on world_memberships (user_id, status, rule_set_id);

create index world_memberships_world_idx
	on world_memberships (rule_set_id, status, role, id);

create trigger world_memberships_set_updated_at
before update on world_memberships
for each row execute function set_updated_at();

create table world_invites (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	token_hash text not null unique,
	role text not null,
	created_by_membership_id uuid not null,
	expires_at timestamptz not null,
	revoked_at timestamptz,
	use_count integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_invites_token_hash_shape
		check (token_hash ~ '^[0-9a-f]{64}$'),
	constraint world_invites_role_valid
		check (role in ('editor', 'player', 'spectator')),
	constraint world_invites_expiry_ordered check (expires_at > created_at),
	constraint world_invites_use_count_nonnegative check (use_count >= 0),
	constraint world_invites_id_world_unique unique (id, rule_set_id),
	constraint world_invites_world_fk
		foreign key (rule_set_id) references world_profiles (rule_set_id) on delete cascade,
	constraint world_invites_creator_fk
		foreign key (created_by_membership_id, rule_set_id)
		references world_memberships (id, rule_set_id) on delete restrict
);

create index world_invites_world_idx
	on world_invites (rule_set_id, revoked_at, expires_at desc, id);

create trigger world_invites_set_updated_at
before update on world_invites
for each row execute function set_updated_at();

create table world_invite_redemptions (
	invite_id uuid not null,
	rule_set_id uuid not null,
	user_id uuid not null,
	world_membership_id uuid not null,
	redeemed_at timestamptz not null default now(),
	constraint world_invite_redemptions_pk primary key (invite_id, user_id),
	constraint world_invite_redemptions_invite_fk
		foreign key (invite_id, rule_set_id)
		references world_invites (id, rule_set_id) on delete cascade,
	constraint world_invite_redemptions_membership_fk
		foreign key (world_membership_id, rule_set_id)
		references world_memberships (id, rule_set_id) on delete cascade,
	constraint world_invite_redemptions_user_fk
		foreign key (user_id) references users (id) on delete restrict
);

create index world_invite_redemptions_user_idx
	on world_invite_redemptions (user_id, redeemed_at desc, invite_id);

-- Capacity and capability definitions reuse the normalized typed-state engine.
-- This table adds only the author-facing mechanic classification and mode;
-- state remains relational in state_variable_definitions/state_values.
create table world_mechanics (
	state_variable_id uuid primary key,
	rule_set_id uuid not null,
	kind text not null,
	mode text not null,
	mutable_during_play boolean not null default true,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_mechanics_kind_valid check (kind in ('capacity', 'capability')),
	constraint world_mechanics_mode_valid check (
		(kind = 'capacity' and mode in ('score', 'pool'))
		or (kind = 'capability' and mode in ('binary', 'rating'))
	),
	constraint world_mechanics_id_world_unique unique (state_variable_id, rule_set_id),
	constraint world_mechanics_world_fk
		foreign key (rule_set_id) references world_profiles (rule_set_id) on delete cascade,
	constraint world_mechanics_definition_fk
		foreign key (state_variable_id, rule_set_id)
		references state_variable_definitions (id, rule_set_id) on delete cascade
);

create index world_mechanics_world_idx
	on world_mechanics (rule_set_id, kind, state_variable_id);

create trigger world_mechanics_set_updated_at
before update on world_mechanics
for each row execute function set_updated_at();
