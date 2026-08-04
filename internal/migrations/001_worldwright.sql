create extension if not exists pgcrypto;

create function set_updated_at() returns trigger language plpgsql as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

create function reject_change() returns trigger language plpgsql as $$
begin
	raise exception 'immutable history cannot be changed';
end;
$$;

create table users (
	id uuid primary key default gen_random_uuid(),
	display_name text not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint users_display_name_nonempty check (btrim(display_name) <> ''),
	constraint users_display_name_length check (char_length(display_name) <= 200)
);

create trigger users_set_updated_at before update on users
for each row execute function set_updated_at();

create table worlds (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	description text,
	status text not null default 'active',
	revision bigint not null default 0,
	table_revision bigint not null default 0,
	created_by_user_id uuid not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint worlds_name_nonempty check (btrim(name) <> ''),
	constraint worlds_name_length check (char_length(name) <= 200),
	constraint worlds_status_valid check (status in ('active', 'archived')),
	constraint worlds_revision_nonnegative check (revision >= 0),
	constraint worlds_table_revision_nonnegative check (table_revision >= 0),
	constraint worlds_created_by_user_fk foreign key (created_by_user_id)
		references users (id) on delete restrict
);

create index worlds_name_idx on worlds (status, lower(name), id);
create trigger worlds_set_updated_at before update on worlds
for each row execute function set_updated_at();

create table world_memberships (
	id uuid primary key default gen_random_uuid(),
	world_id uuid not null,
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
	constraint world_memberships_joined_shape check (status <> 'active' or joined_at is not null),
	constraint world_memberships_world_user_unique unique (world_id, user_id),
	constraint world_memberships_id_world_unique unique (id, world_id),
	constraint world_memberships_world_fk foreign key (world_id)
		references worlds (id) on delete cascade,
	constraint world_memberships_user_fk foreign key (user_id)
		references users (id) on delete restrict
);

create index world_memberships_user_idx on world_memberships (user_id, status, world_id);
create index world_memberships_world_idx on world_memberships (world_id, status, role, id);
create trigger world_memberships_set_updated_at before update on world_memberships
for each row execute function set_updated_at();

create table world_invites (
	id uuid primary key default gen_random_uuid(),
	world_id uuid not null,
	token_hash text not null unique,
	role text not null,
	created_by_membership_id uuid not null,
	expires_at timestamptz not null,
	revoked_at timestamptz,
	use_count integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_invites_token_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
	constraint world_invites_role_valid check (role in ('editor', 'player', 'spectator')),
	constraint world_invites_expiry_ordered check (expires_at > created_at),
	constraint world_invites_use_count_nonnegative check (use_count >= 0),
	constraint world_invites_id_world_unique unique (id, world_id),
	constraint world_invites_world_fk foreign key (world_id)
		references worlds (id) on delete cascade,
	constraint world_invites_creator_fk foreign key (created_by_membership_id, world_id)
		references world_memberships (id, world_id) on delete restrict
);

create index world_invites_world_idx on world_invites (world_id, revoked_at, expires_at desc, id);
create trigger world_invites_set_updated_at before update on world_invites
for each row execute function set_updated_at();

create table world_invite_redemptions (
	invite_id uuid not null,
	world_id uuid not null,
	user_id uuid not null,
	world_membership_id uuid not null,
	redeemed_at timestamptz not null default now(),
	constraint world_invite_redemptions_pk primary key (invite_id, user_id),
	constraint world_invite_redemptions_invite_fk foreign key (invite_id, world_id)
		references world_invites (id, world_id) on delete cascade,
	constraint world_invite_redemptions_membership_fk foreign key (world_membership_id, world_id)
		references world_memberships (id, world_id) on delete cascade,
	constraint world_invite_redemptions_user_fk foreign key (user_id)
		references users (id) on delete restrict
);

create index world_invite_redemptions_user_idx
	on world_invite_redemptions (user_id, redeemed_at desc, invite_id);

create table world_mechanics (
	id uuid primary key default gen_random_uuid(),
	world_id uuid not null,
	kind text not null,
	mode text not null,
	value_kind text not null,
	name text not null,
	description text,
	minimum numeric,
	maximum numeric,
	step numeric,
	default_number numeric,
	unit text,
	mutable_during_play boolean not null default true,
	position integer not null,
	archived boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_mechanics_name_nonempty check (btrim(name) <> ''),
	constraint world_mechanics_name_length check (char_length(name) <= 200),
	constraint world_mechanics_kind_valid check (kind in ('capacity', 'capability')),
	constraint world_mechanics_mode_valid check (
		(kind = 'capacity' and mode in ('score', 'pool'))
		or (kind = 'capability' and mode in ('binary', 'rating'))
	),
	constraint world_mechanics_value_kind_valid check (
		(mode = 'binary' and value_kind = 'boolean')
		or (mode <> 'binary' and value_kind = 'number')
	),
	constraint world_mechanics_numeric_shape check (
		(value_kind = 'boolean' and minimum is null and maximum is null and step is null
			and default_number is null and unit is null)
		or (value_kind = 'number' and default_number is not null)
	),
	constraint world_mechanics_bounds_ordered check (
		minimum is null or maximum is null or minimum <= maximum
	),
	constraint world_mechanics_step_positive check (step is null or step > 0),
	constraint world_mechanics_default_minimum check (minimum is null or default_number >= minimum),
	constraint world_mechanics_default_maximum check (maximum is null or default_number <= maximum),
	constraint world_mechanics_position_nonnegative check (position >= 0),
	constraint world_mechanics_id_world_unique unique (id, world_id),
	constraint world_mechanics_id_world_kind_unique unique (id, world_id, value_kind),
	constraint world_mechanics_world_position_unique unique (world_id, kind, position),
	constraint world_mechanics_world_fk foreign key (world_id)
		references worlds (id) on delete cascade
);

create index world_mechanics_world_idx on world_mechanics (world_id, kind, archived, position, id);
create trigger world_mechanics_set_updated_at before update on world_mechanics
for each row execute function set_updated_at();

create table entities (
	id uuid primary key default gen_random_uuid(),
	world_id uuid not null,
	display_name text not null,
	archived boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint entities_display_name_nonempty check (btrim(display_name) <> ''),
	constraint entities_display_name_length check (char_length(display_name) <= 200),
	constraint entities_id_world_unique unique (id, world_id),
	constraint entities_world_fk foreign key (world_id)
		references worlds (id) on delete cascade
);

create index entities_world_idx on entities (world_id, archived, lower(display_name), id);
create trigger entities_set_updated_at before update on entities
for each row execute function set_updated_at();

create table state_records (
	entity_id uuid primary key,
	world_id uuid not null,
	revision bigint not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint state_records_revision_nonnegative check (revision >= 0),
	constraint state_records_id_world_unique unique (entity_id, world_id),
	constraint state_records_entity_fk foreign key (entity_id, world_id)
		references entities (id, world_id) on delete cascade
);

create index state_records_world_idx on state_records (world_id, entity_id);
create trigger state_records_set_updated_at before update on state_records
for each row execute function set_updated_at();

create table state_values (
	entity_id uuid not null,
	world_id uuid not null,
	mechanic_id uuid not null,
	value_kind text not null,
	number_value numeric,
	boolean_value boolean,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint state_values_pk primary key (entity_id, mechanic_id),
	constraint state_values_shape check (
		(value_kind = 'number' and number_value is not null and boolean_value is null)
		or (value_kind = 'boolean' and number_value is null and boolean_value is not null)
	),
	constraint state_values_record_fk foreign key (entity_id, world_id)
		references state_records (entity_id, world_id) on delete cascade,
	constraint state_values_mechanic_fk foreign key (mechanic_id, world_id, value_kind)
		references world_mechanics (id, world_id, value_kind) on delete restrict
);

create index state_values_mechanic_idx on state_values (world_id, mechanic_id, entity_id);
create trigger state_values_set_updated_at before update on state_values
for each row execute function set_updated_at();

create table world_character_field_sets (
	world_id uuid primary key,
	revision bigint not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_character_field_sets_revision_nonnegative check (revision >= 0),
	constraint world_character_field_sets_world_fk foreign key (world_id)
		references worlds (id) on delete cascade
);

create trigger world_character_field_sets_set_updated_at before update on world_character_field_sets
for each row execute function set_updated_at();

create table world_character_fields (
	id uuid primary key default gen_random_uuid(),
	world_id uuid not null,
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
	constraint world_character_fields_help_length check (help_text is null or char_length(help_text) <= 2000),
	constraint world_character_fields_visibility_valid
		check (visibility in ('table', 'controllers-and-facilitators')),
	constraint world_character_fields_position_nonnegative check (position >= 0),
	constraint world_character_fields_id_world_unique unique (id, world_id),
	constraint world_character_fields_set_fk foreign key (world_id)
		references world_character_field_sets (world_id) on delete cascade,
	constraint world_character_fields_created_by_user_fk foreign key (created_by_user_id)
		references users (id) on delete restrict,
	constraint world_character_fields_updated_by_user_fk foreign key (updated_by_user_id)
		references users (id) on delete restrict
);

create index world_character_fields_world_idx
	on world_character_fields (world_id, archived, position, id);
create trigger world_character_fields_set_updated_at before update on world_character_fields
for each row execute function set_updated_at();

create table entity_profiles (
	entity_id uuid primary key,
	world_id uuid not null,
	revision bigint not null default 0,
	created_by_user_id uuid not null,
	updated_by_user_id uuid not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint entity_profiles_revision_nonnegative check (revision >= 0),
	constraint entity_profiles_id_world_unique unique (entity_id, world_id),
	constraint entity_profiles_entity_fk foreign key (entity_id, world_id)
		references entities (id, world_id) on delete cascade,
	constraint entity_profiles_created_by_user_fk foreign key (created_by_user_id)
		references users (id) on delete restrict,
	constraint entity_profiles_updated_by_user_fk foreign key (updated_by_user_id)
		references users (id) on delete restrict
);

create index entity_profiles_world_idx on entity_profiles (world_id, entity_id);
create trigger entity_profiles_set_updated_at before update on entity_profiles
for each row execute function set_updated_at();

create table entity_profile_field_values (
	entity_id uuid not null,
	field_id uuid not null,
	world_id uuid not null,
	body text not null,
	created_by_user_id uuid not null,
	updated_by_user_id uuid not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint entity_profile_field_values_pk primary key (entity_id, field_id),
	constraint entity_profile_field_values_body_nonempty check (btrim(body) <> ''),
	constraint entity_profile_field_values_body_length check (char_length(body) <= 20000),
	constraint entity_profile_field_values_profile_fk foreign key (entity_id, world_id)
		references entity_profiles (entity_id, world_id) on delete cascade,
	constraint entity_profile_field_values_field_fk foreign key (field_id, world_id)
		references world_character_fields (id, world_id) on delete restrict,
	constraint entity_profile_field_values_created_by_user_fk foreign key (created_by_user_id)
		references users (id) on delete restrict,
	constraint entity_profile_field_values_updated_by_user_fk foreign key (updated_by_user_id)
		references users (id) on delete restrict
);

create index entity_profile_field_values_world_field_idx
	on entity_profile_field_values (world_id, field_id, entity_id);
create trigger entity_profile_field_values_set_updated_at before update on entity_profile_field_values
for each row execute function set_updated_at();

create table world_membership_entity_controls (
	world_id uuid not null,
	membership_id uuid not null,
	entity_id uuid not null,
	created_at timestamptz not null default now(),
	constraint world_membership_entity_controls_pk primary key (membership_id, entity_id),
	constraint world_membership_entity_controls_membership_fk foreign key (membership_id, world_id)
		references world_memberships (id, world_id) on delete cascade,
	constraint world_membership_entity_controls_entity_fk foreign key (entity_id, world_id)
		references entities (id, world_id) on delete cascade
);

create index world_membership_entity_controls_entity_idx
	on world_membership_entity_controls (world_id, entity_id, membership_id);

create table interactions (
	id uuid primary key default gen_random_uuid(),
	world_id uuid not null,
	title text,
	prompt text not null,
	private_notes text,
	status text not null default 'draft',
	revision bigint not null default 0,
	created_by_membership_id uuid not null,
	presented_at timestamptz,
	resolved_at timestamptz,
	cancelled_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint interactions_title_nonempty check (title is null or btrim(title) <> ''),
	constraint interactions_title_length check (title is null or char_length(title) <= 200),
	constraint interactions_prompt_nonempty check (btrim(prompt) <> ''),
	constraint interactions_prompt_length check (char_length(prompt) <= 10000),
	constraint interactions_private_notes_length check (private_notes is null or char_length(private_notes) <= 20000),
	constraint interactions_status_valid
		check (status in ('draft', 'open', 'adjudicating', 'resolved', 'cancelled')),
	constraint interactions_revision_nonnegative check (revision >= 0),
	constraint interactions_lifecycle_shape check (
		(status = 'draft' and presented_at is null and resolved_at is null and cancelled_at is null)
		or (status in ('open', 'adjudicating') and presented_at is not null and resolved_at is null and cancelled_at is null)
		or (status = 'resolved' and presented_at is not null and resolved_at is not null and cancelled_at is null)
		or (status = 'cancelled' and resolved_at is null and cancelled_at is not null)
	),
	constraint interactions_id_world_unique unique (id, world_id),
	constraint interactions_world_fk foreign key (world_id)
		references worlds (id) on delete cascade,
	constraint interactions_created_by_membership_fk foreign key (created_by_membership_id, world_id)
		references world_memberships (id, world_id) on delete restrict
);

create index interactions_world_feed_idx on interactions (world_id, created_at desc, id);
create index interactions_world_status_idx on interactions (world_id, status, updated_at desc, id);
create trigger interactions_set_updated_at before update on interactions
for each row execute function set_updated_at();

create table interaction_audience_members (
	interaction_id uuid not null,
	world_id uuid not null,
	membership_id uuid not null,
	constraint interaction_audience_members_pk primary key (interaction_id, membership_id),
	constraint interaction_audience_members_interaction_fk foreign key (interaction_id, world_id)
		references interactions (id, world_id) on delete cascade,
	constraint interaction_audience_members_membership_fk foreign key (membership_id, world_id)
		references world_memberships (id, world_id) on delete restrict
);

create index interaction_audience_members_member_idx
	on interaction_audience_members (world_id, membership_id, interaction_id);

create table interaction_eligible_responders (
	interaction_id uuid not null,
	world_id uuid not null,
	membership_id uuid not null,
	constraint interaction_eligible_responders_pk primary key (interaction_id, membership_id),
	constraint interaction_eligible_responders_interaction_fk foreign key (interaction_id, world_id)
		references interactions (id, world_id) on delete cascade,
	constraint interaction_eligible_responders_membership_fk foreign key (membership_id, world_id)
		references world_memberships (id, world_id) on delete restrict
);

create index interaction_eligible_responders_member_idx
	on interaction_eligible_responders (world_id, membership_id, interaction_id);

create table interaction_context_entities (
	interaction_id uuid not null,
	world_id uuid not null,
	entity_id uuid not null,
	label text,
	visibility text not null default 'public',
	position integer not null,
	constraint interaction_context_entities_pk primary key (interaction_id, entity_id),
	constraint interaction_context_entities_label_nonempty check (label is null or btrim(label) <> ''),
	constraint interaction_context_entities_visibility_valid check (visibility in ('public', 'facilitator')),
	constraint interaction_context_entities_position_nonnegative check (position >= 0),
	constraint interaction_context_entities_position_unique unique (interaction_id, position),
	constraint interaction_context_entities_interaction_fk foreign key (interaction_id, world_id)
		references interactions (id, world_id) on delete cascade,
	constraint interaction_context_entities_entity_fk foreign key (entity_id, world_id)
		references entities (id, world_id) on delete restrict
);

create index interaction_context_entities_entity_idx
	on interaction_context_entities (world_id, entity_id, interaction_id);

create table interaction_action_submissions (
	id uuid primary key default gen_random_uuid(),
	interaction_id uuid not null,
	world_id uuid not null,
	submitted_by_membership_id uuid not null,
	acting_entity_id uuid,
	acting_entity_name text,
	text text not null,
	status text not null default 'submitted',
	revision bigint not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint interaction_action_submissions_text_nonempty check (btrim(text) <> ''),
	constraint interaction_action_submissions_text_length check (char_length(text) <= 10000),
	constraint interaction_action_submissions_status_valid
		check (status in ('submitted', 'withdrawn', 'selected', 'declined')),
	constraint interaction_action_submissions_revision_nonnegative check (revision >= 0),
	constraint interaction_action_submissions_acting_shape check (
		(acting_entity_id is null and acting_entity_name is null)
		or (acting_entity_id is not null and acting_entity_name is not null and btrim(acting_entity_name) <> '')
	),
	constraint interaction_action_submissions_id_world_unique unique (id, world_id),
	constraint interaction_action_submissions_id_interaction_world_unique unique (id, interaction_id, world_id),
	constraint interaction_action_submissions_interaction_fk foreign key (interaction_id, world_id)
		references interactions (id, world_id) on delete cascade,
	constraint interaction_action_submissions_membership_fk foreign key (submitted_by_membership_id, world_id)
		references world_memberships (id, world_id) on delete restrict,
	constraint interaction_action_submissions_acting_entity_fk foreign key (acting_entity_id, world_id)
		references entities (id, world_id) on delete restrict
);

create index interaction_action_submissions_interaction_idx
	on interaction_action_submissions (interaction_id, status, created_at, id);
create index interaction_action_submissions_member_idx
	on interaction_action_submissions (world_id, submitted_by_membership_id, created_at desc, id);
create unique index interaction_action_submissions_one_selected_unique
	on interaction_action_submissions (interaction_id) where status = 'selected';
create trigger interaction_action_submissions_set_updated_at before update on interaction_action_submissions
for each row execute function set_updated_at();

create table interaction_resolutions (
	id uuid primary key default gen_random_uuid(),
	interaction_id uuid not null,
	world_id uuid not null,
	selected_submission_id uuid,
	action_summary text,
	public_narrative text not null,
	private_notes text,
	status text not null default 'draft',
	created_by_membership_id uuid not null,
	resolved_by_membership_id uuid,
	idempotency_key text,
	applied_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint interaction_resolutions_action_summary_nonempty
		check (action_summary is null or btrim(action_summary) <> ''),
	constraint interaction_resolutions_action_summary_length
		check (action_summary is null or char_length(action_summary) <= 10000),
	constraint interaction_resolutions_public_narrative_nonempty check (btrim(public_narrative) <> ''),
	constraint interaction_resolutions_public_narrative_length check (char_length(public_narrative) <= 20000),
	constraint interaction_resolutions_private_notes_length
		check (private_notes is null or char_length(private_notes) <= 20000),
	constraint interaction_resolutions_idempotency_key_nonempty
		check (idempotency_key is null or btrim(idempotency_key) <> ''),
	constraint interaction_resolutions_idempotency_key_length
		check (idempotency_key is null or char_length(idempotency_key) <= 200),
	constraint interaction_resolutions_status_valid check (status in ('draft', 'applied')),
	constraint interaction_resolutions_applied_shape check (
		(status = 'draft' and resolved_by_membership_id is null and applied_at is null and idempotency_key is null)
		or (status = 'applied' and resolved_by_membership_id is not null and applied_at is not null and idempotency_key is not null)
	),
	constraint interaction_resolutions_interaction_unique unique (interaction_id),
	constraint interaction_resolutions_id_world_unique unique (id, world_id),
	constraint interaction_resolutions_world_fk foreign key (world_id)
		references worlds (id) on delete cascade,
	constraint interaction_resolutions_interaction_fk foreign key (interaction_id, world_id)
		references interactions (id, world_id) on delete cascade,
	constraint interaction_resolutions_selected_submission_fk
		foreign key (selected_submission_id, interaction_id, world_id)
		references interaction_action_submissions (id, interaction_id, world_id) on delete restrict,
	constraint interaction_resolutions_created_by_membership_fk
		foreign key (created_by_membership_id, world_id)
		references world_memberships (id, world_id) on delete restrict,
	constraint interaction_resolutions_resolved_by_membership_fk
		foreign key (resolved_by_membership_id, world_id)
		references world_memberships (id, world_id) on delete restrict
);

create unique index interaction_resolutions_idempotency_unique
	on interaction_resolutions (world_id, idempotency_key) where idempotency_key is not null;
create trigger interaction_resolutions_set_updated_at before update on interaction_resolutions
for each row execute function set_updated_at();

create table interaction_resolution_effects (
	id uuid primary key default gen_random_uuid(),
	resolution_id uuid not null,
	world_id uuid not null,
	position integer not null,
	operation text not null,
	mechanic_id uuid not null,
	value_kind text not null,
	set_number numeric,
	set_boolean boolean,
	adjustment_amount numeric,
	constraint interaction_resolution_effects_position_nonnegative check (position >= 0),
	constraint interaction_resolution_effects_operation_valid check (operation in ('set', 'adjust-number')),
	constraint interaction_resolution_effects_operand_shape check (
		(operation = 'adjust-number' and value_kind = 'number' and adjustment_amount is not null
			and set_number is null and set_boolean is null)
		or (operation = 'set' and adjustment_amount is null and (
			(value_kind = 'number' and set_number is not null and set_boolean is null)
			or (value_kind = 'boolean' and set_number is null and set_boolean is not null)
		))
	),
	constraint interaction_resolution_effects_resolution_position_unique unique (resolution_id, position),
	constraint interaction_resolution_effects_id_resolution_world_unique unique (id, resolution_id, world_id),
	constraint interaction_resolution_effects_resolution_fk foreign key (resolution_id, world_id)
		references interaction_resolutions (id, world_id) on delete cascade,
	constraint interaction_resolution_effects_mechanic_fk foreign key (mechanic_id, world_id, value_kind)
		references world_mechanics (id, world_id, value_kind) on delete restrict
);

create index interaction_resolution_effects_mechanic_idx
	on interaction_resolution_effects (world_id, mechanic_id, resolution_id);

create table interaction_resolution_effect_targets (
	effect_id uuid not null,
	resolution_id uuid not null,
	world_id uuid not null,
	entity_id uuid not null,
	position integer not null,
	constraint interaction_resolution_effect_targets_pk primary key (effect_id, entity_id),
	constraint interaction_resolution_effect_targets_position_nonnegative check (position >= 0),
	constraint interaction_resolution_effect_targets_position_unique unique (effect_id, position),
	constraint interaction_resolution_effect_targets_effect_fk
		foreign key (effect_id, resolution_id, world_id)
		references interaction_resolution_effects (id, resolution_id, world_id) on delete cascade,
	constraint interaction_resolution_effect_targets_entity_fk foreign key (entity_id, world_id)
		references entities (id, world_id) on delete restrict
);

create index interaction_resolution_effect_targets_entity_idx
	on interaction_resolution_effect_targets (world_id, entity_id, effect_id);

create table interaction_resolution_effect_applications (
	id uuid primary key default gen_random_uuid(),
	resolution_id uuid not null,
	effect_id uuid not null,
	world_id uuid not null,
	mechanic_id uuid not null,
	value_kind text not null,
	entity_id uuid not null,
	position integer not null,
	changed boolean not null,
	before_number numeric,
	before_boolean boolean,
	after_number numeric,
	after_boolean boolean,
	constraint interaction_resolution_effect_applications_position_nonnegative check (position >= 0),
	constraint interaction_resolution_effect_applications_value_shape check (
		(value_kind = 'number' and before_number is not null and before_boolean is null
			and after_number is not null and after_boolean is null)
		or (value_kind = 'boolean' and before_number is null and before_boolean is not null
			and after_number is null and after_boolean is not null)
	),
	constraint interaction_resolution_effect_applications_effect_entity_unique unique (effect_id, entity_id),
	constraint interaction_resolution_effect_applications_resolution_position_unique unique (resolution_id, position),
	constraint interaction_resolution_effect_applications_effect_fk
		foreign key (effect_id, resolution_id, world_id)
		references interaction_resolution_effects (id, resolution_id, world_id) on delete cascade,
	constraint interaction_resolution_effect_applications_mechanic_fk
		foreign key (mechanic_id, world_id, value_kind)
		references world_mechanics (id, world_id, value_kind) on delete restrict,
	constraint interaction_resolution_effect_applications_entity_fk foreign key (entity_id, world_id)
		references entities (id, world_id) on delete restrict
);

create index interaction_resolution_effect_applications_entity_idx
	on interaction_resolution_effect_applications (world_id, entity_id, resolution_id);

create table world_events (
	id bigint generated always as identity primary key,
	world_id uuid not null,
	event_type text not null,
	actor_membership_id uuid,
	interaction_id uuid,
	submission_id uuid,
	resolution_id uuid,
	created_at timestamptz not null default now(),
	constraint world_events_type_valid check (event_type in (
		'world-created', 'world-archived', 'membership-created', 'membership-updated',
		'entity-created', 'entity-control-updated', 'entity-profile-updated',
		'character-fields-updated', 'interaction-created', 'interaction-updated',
		'interaction-presented', 'interaction-adjudicating', 'interaction-cancelled',
		'submission-created', 'submission-withdrawn', 'resolution-updated', 'resolution-applied'
	)),
	constraint world_events_world_fk foreign key (world_id)
		references worlds (id) on delete cascade,
	constraint world_events_actor_fk foreign key (actor_membership_id, world_id)
		references world_memberships (id, world_id) on delete restrict,
	constraint world_events_interaction_fk foreign key (interaction_id, world_id)
		references interactions (id, world_id) on delete restrict,
	constraint world_events_submission_fk foreign key (submission_id, world_id)
		references interaction_action_submissions (id, world_id) on delete restrict,
	constraint world_events_resolution_fk foreign key (resolution_id, world_id)
		references interaction_resolutions (id, world_id) on delete restrict
);

create index world_events_world_cursor_idx on world_events (world_id, id);

create function protect_final_interaction() returns trigger language plpgsql as $$
begin
	if old.status in ('resolved', 'cancelled') then
		raise exception 'final interaction cannot be changed';
	end if;
	return new;
end;
$$;

create trigger interactions_protect_final before update or delete on interactions
for each row execute function protect_final_interaction();

create function protect_applied_resolution_tree() returns trigger language plpgsql as $$
declare
	parent_status text;
begin
	if tg_table_name = 'interaction_resolutions' then
		parent_status := old.status;
	else
		select status into parent_status from interaction_resolutions
		where id = old.resolution_id;
	end if;
	if parent_status = 'applied' then
		raise exception 'applied resolution history cannot be changed';
	end if;
	return new;
end;
$$;

create trigger interaction_resolutions_protect_applied
before update or delete on interaction_resolutions
for each row execute function protect_applied_resolution_tree();
create trigger interaction_resolution_effects_protect_applied
before update or delete on interaction_resolution_effects
for each row execute function protect_applied_resolution_tree();
create trigger interaction_resolution_effect_targets_protect_applied
before update or delete on interaction_resolution_effect_targets
for each row execute function protect_applied_resolution_tree();
create trigger interaction_resolution_effect_applications_protect_applied
before update or delete on interaction_resolution_effect_applications
for each row execute function protect_applied_resolution_tree();

create trigger world_events_protect_immutable before update or delete on world_events
for each row execute function reject_change();
