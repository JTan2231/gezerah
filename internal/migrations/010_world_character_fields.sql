-- Character requirements are world-authored presentation data. They remain
-- separate from typed engine state and are activated only by player-control
-- relationships; no configured key or owner schema is privileged.
create table world_character_field_sets (
	rule_set_id uuid primary key,
	revision bigint not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_character_field_sets_revision_nonnegative check (revision >= 0),
	constraint world_character_field_sets_world_fk
		foreign key (rule_set_id) references world_profiles (rule_set_id) on delete cascade
);

insert into world_character_field_sets (rule_set_id)
select rule_set_id from world_profiles;

create trigger world_character_field_sets_set_updated_at
before update on world_character_field_sets
for each row execute function set_updated_at();

create table world_character_fields (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	label text not null,
	help_text text,
	visibility text not null default 'table',
	position integer not null,
	archived boolean not null default false,
	created_by_user_id uuid not null,
	updated_by_user_id uuid not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_character_fields_label_nonempty check (btrim(label) <> ''),
	constraint world_character_fields_label_length check (char_length(label) <= 200),
	constraint world_character_fields_help_length check (
		help_text is null or char_length(help_text) <= 2000
	),
	constraint world_character_fields_visibility_valid
		check (visibility in ('table', 'controllers-and-facilitators')),
	constraint world_character_fields_position_nonnegative check (position >= 0),
	constraint world_character_fields_id_world_unique unique (id, rule_set_id),
	constraint world_character_fields_set_fk
		foreign key (rule_set_id)
		references world_character_field_sets (rule_set_id) on delete cascade,
	constraint world_character_fields_created_by_user_fk
		foreign key (created_by_user_id) references users (id) on delete restrict,
	constraint world_character_fields_updated_by_user_fk
		foreign key (updated_by_user_id) references users (id) on delete restrict
);

create index world_character_fields_world_idx
	on world_character_fields (rule_set_id, archived, position, id);

create trigger world_character_fields_set_updated_at
before update on world_character_fields
for each row execute function set_updated_at();

create table entity_profile_field_values (
	entity_id uuid not null,
	field_id uuid not null,
	rule_set_id uuid not null,
	body text not null,
	created_by_user_id uuid not null,
	updated_by_user_id uuid not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint entity_profile_field_values_pk primary key (entity_id, field_id),
	constraint entity_profile_field_values_body_nonempty check (btrim(body) <> ''),
	constraint entity_profile_field_values_body_length check (char_length(body) <= 20000),
	constraint entity_profile_field_values_profile_fk
		foreign key (entity_id, rule_set_id)
		references entity_profiles (entity_id, rule_set_id) on delete cascade,
	constraint entity_profile_field_values_field_fk
		foreign key (field_id, rule_set_id)
		references world_character_fields (id, rule_set_id) on delete restrict,
	constraint entity_profile_field_values_created_by_user_fk
		foreign key (created_by_user_id) references users (id) on delete restrict,
	constraint entity_profile_field_values_updated_by_user_fk
		foreign key (updated_by_user_id) references users (id) on delete restrict
);

create index entity_profile_field_values_world_field_idx
	on entity_profile_field_values (rule_set_id, field_id, entity_id);

create trigger entity_profile_field_values_set_updated_at
before update on entity_profile_field_values
for each row execute function set_updated_at();

alter table game_events drop constraint game_events_type_valid;

alter table game_events add constraint game_events_type_valid check (event_type in (
	'game-created',
	'game-archived',
	'membership-created',
	'membership-updated',
	'entity-assigned',
	'entity-control-updated',
	'entity-profile-updated',
	'character-fields-updated',
	'interaction-created',
	'interaction-updated',
	'interaction-presented',
	'interaction-adjudicating',
	'interaction-cancelled',
	'submission-created',
	'submission-withdrawn',
	'resolution-updated',
	'resolution-applied'
));
