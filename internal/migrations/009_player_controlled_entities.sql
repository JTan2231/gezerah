-- Player control is represented by the existing
-- game_membership_entity_controls relation. Narrative profiles remain a
-- separate, ruleset-scoped product aggregate and are never loaded as engine
-- state.
create table entity_profiles (
	entity_id uuid primary key,
	rule_set_id uuid not null,
	revision bigint not null default 0,
	created_by_user_id uuid not null,
	updated_by_user_id uuid not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint entity_profiles_revision_nonnegative check (revision >= 0),
	constraint entity_profiles_entity_rule_set_unique unique (entity_id, rule_set_id),
	constraint entity_profiles_entity_fk
		foreign key (entity_id, rule_set_id)
		references entities (id, rule_set_id) on delete cascade,
	constraint entity_profiles_world_fk
		foreign key (rule_set_id)
		references world_profiles (rule_set_id) on delete cascade,
	constraint entity_profiles_created_by_user_fk
		foreign key (created_by_user_id) references users (id) on delete restrict,
	constraint entity_profiles_updated_by_user_fk
		foreign key (updated_by_user_id) references users (id) on delete restrict
);

create index entity_profiles_rule_set_idx
	on entity_profiles (rule_set_id, updated_at desc, entity_id);

create trigger entity_profiles_set_updated_at
before update on entity_profiles
for each row execute function set_updated_at();

create table entity_profile_sections (
	id uuid primary key default gen_random_uuid(),
	entity_id uuid not null,
	rule_set_id uuid not null,
	title text not null,
	body text not null,
	visibility text not null default 'table',
	position integer not null,
	created_by_user_id uuid not null,
	updated_by_user_id uuid not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint entity_profile_sections_title_nonempty check (btrim(title) <> ''),
	constraint entity_profile_sections_title_length check (char_length(title) <= 200),
	constraint entity_profile_sections_body_nonempty check (btrim(body) <> ''),
	constraint entity_profile_sections_body_length check (char_length(body) <= 20000),
	constraint entity_profile_sections_visibility_valid
		check (visibility in ('table', 'controllers-and-facilitators')),
	constraint entity_profile_sections_position_nonnegative check (position >= 0),
	constraint entity_profile_sections_entity_position_unique
		unique (entity_id, position),
	constraint entity_profile_sections_id_entity_rule_set_unique
		unique (id, entity_id, rule_set_id),
	constraint entity_profile_sections_profile_fk
		foreign key (entity_id, rule_set_id)
		references entity_profiles (entity_id, rule_set_id) on delete cascade,
	constraint entity_profile_sections_created_by_user_fk
		foreign key (created_by_user_id) references users (id) on delete restrict,
	constraint entity_profile_sections_updated_by_user_fk
		foreign key (updated_by_user_id) references users (id) on delete restrict
);

create index entity_profile_sections_profile_idx
	on entity_profile_sections (entity_id, position, id);

create trigger entity_profile_sections_set_updated_at
before update on entity_profile_sections
for each row execute function set_updated_at();

-- Action attribution is optional. The display-name snapshot keeps resolved
-- table history legible after a later entity rename. Authorization against a
-- control grant is checked when the action is submitted; the historical row
-- deliberately does not retain a foreign key to that mutable grant.
alter table interaction_action_submissions
	add column acting_entity_id uuid,
	add column acting_entity_name text,
	add constraint interaction_action_submissions_acting_entity_shape check (
		(acting_entity_id is null and acting_entity_name is null)
		or (
			acting_entity_id is not null
			and acting_entity_name is not null
			and btrim(acting_entity_name) <> ''
			and char_length(acting_entity_name) <= 200
		)
	),
	add constraint interaction_action_submissions_acting_entity_fk
		foreign key (acting_entity_id, game_id)
		references game_entities (entity_id, game_id) on delete restrict;

create index interaction_action_submissions_acting_entity_idx
	on interaction_action_submissions (game_id, acting_entity_id, created_at desc, id)
	where acting_entity_id is not null;

alter table game_events drop constraint game_events_type_valid;

alter table game_events add constraint game_events_type_valid check (event_type in (
	'game-created',
	'game-archived',
	'membership-created',
	'membership-updated',
	'entity-assigned',
	'entity-control-updated',
	'entity-profile-updated',
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
