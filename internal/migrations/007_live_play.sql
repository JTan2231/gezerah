create table users (
	id uuid primary key default gen_random_uuid(),
	display_name text not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint users_display_name_nonempty check (btrim(display_name) <> '')
);

create trigger users_set_updated_at
before update on users
for each row execute function set_updated_at();

create table games (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	name text not null,
	status text not null default 'active',
	revision bigint not null default 0,
	created_by_user_id uuid not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint games_name_nonempty check (btrim(name) <> ''),
	constraint games_status_valid check (status in ('active', 'archived')),
	constraint games_revision_nonnegative check (revision >= 0),
	constraint games_id_rule_set_unique unique (id, rule_set_id),
	constraint games_rule_set_fk
		foreign key (rule_set_id) references rule_sets (id) on delete cascade,
	constraint games_created_by_user_fk
		foreign key (created_by_user_id) references users (id) on delete restrict
);

create index games_rule_set_idx
	on games (rule_set_id, status, lower(name), id);

create index games_created_by_user_idx
	on games (created_by_user_id, status, id);

create trigger games_set_updated_at
before update on games
for each row execute function set_updated_at();

create table game_memberships (
	id uuid primary key default gen_random_uuid(),
	game_id uuid not null,
	user_id uuid not null,
	role text not null,
	status text not null default 'active',
	revision bigint not null default 0,
	joined_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint game_memberships_role_valid
		check (role in ('facilitator', 'player', 'spectator')),
	constraint game_memberships_status_valid
		check (status in ('invited', 'active', 'left')),
	constraint game_memberships_revision_nonnegative check (revision >= 0),
	constraint game_memberships_joined_shape
		check (status <> 'active' or joined_at is not null),
	constraint game_memberships_game_user_unique unique (game_id, user_id),
	constraint game_memberships_id_game_unique unique (id, game_id),
	constraint game_memberships_game_fk
		foreign key (game_id) references games (id) on delete cascade,
	constraint game_memberships_user_fk
		foreign key (user_id) references users (id) on delete restrict
);

create index game_memberships_user_idx
	on game_memberships (user_id, status, game_id);

create index game_memberships_game_idx
	on game_memberships (game_id, status, role, id);

create trigger game_memberships_set_updated_at
before update on game_memberships
for each row execute function set_updated_at();

-- An entity remains ruleset-scoped until a facilitator explicitly assigns it
-- to a game. Once assigned, the primary key below makes that assignment
-- exclusive while the composite foreign keys prove ruleset compatibility.
create table game_entities (
	entity_id uuid primary key,
	game_id uuid not null,
	rule_set_id uuid not null,
	assigned_at timestamptz not null default now(),
	constraint game_entities_entity_game_unique unique (entity_id, game_id),
	constraint game_entities_game_entity_unique unique (game_id, entity_id),
	constraint game_entities_game_rule_set_fk
		foreign key (game_id, rule_set_id)
		references games (id, rule_set_id) on delete cascade,
	constraint game_entities_entity_rule_set_fk
		foreign key (entity_id, rule_set_id)
		references entities (id, rule_set_id) on delete cascade
);

create index game_entities_game_idx
	on game_entities (game_id, entity_id);

create table game_membership_entity_controls (
	game_id uuid not null,
	membership_id uuid not null,
	entity_id uuid not null,
	created_at timestamptz not null default now(),
	constraint game_membership_entity_controls_pk
		primary key (membership_id, entity_id),
	constraint game_membership_entity_controls_membership_fk
		foreign key (membership_id, game_id)
		references game_memberships (id, game_id) on delete cascade,
	constraint game_membership_entity_controls_entity_fk
		foreign key (entity_id, game_id)
		references game_entities (entity_id, game_id) on delete cascade
);

create index game_membership_entity_controls_entity_idx
	on game_membership_entity_controls (game_id, entity_id, membership_id);

create table interactions (
	id uuid primary key default gen_random_uuid(),
	game_id uuid not null,
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
	constraint interactions_title_nonempty
		check (title is null or btrim(title) <> ''),
	constraint interactions_title_length check (title is null or char_length(title) <= 200),
	constraint interactions_prompt_nonempty check (btrim(prompt) <> ''),
	constraint interactions_prompt_length check (char_length(prompt) <= 10000),
	constraint interactions_private_notes_length
		check (private_notes is null or char_length(private_notes) <= 20000),
	constraint interactions_status_valid
		check (status in ('draft', 'open', 'adjudicating', 'resolved', 'cancelled')),
	constraint interactions_revision_nonnegative check (revision >= 0),
	constraint interactions_lifecycle_shape check (
		(status = 'draft' and presented_at is null and resolved_at is null and cancelled_at is null)
		or (status in ('open', 'adjudicating') and presented_at is not null and resolved_at is null and cancelled_at is null)
		or (status = 'resolved' and presented_at is not null and resolved_at is not null and cancelled_at is null)
		or (status = 'cancelled' and resolved_at is null and cancelled_at is not null)
	),
	constraint interactions_id_game_unique unique (id, game_id),
	constraint interactions_game_fk
		foreign key (game_id) references games (id) on delete cascade,
	constraint interactions_created_by_membership_fk
		foreign key (created_by_membership_id, game_id)
		references game_memberships (id, game_id) on delete restrict
);

create index interactions_game_feed_idx
	on interactions (game_id, created_at desc, id);

create index interactions_game_status_idx
	on interactions (game_id, status, updated_at desc, id);

create trigger interactions_set_updated_at
before update on interactions
for each row execute function set_updated_at();

create table interaction_audience_members (
	interaction_id uuid not null,
	game_id uuid not null,
	membership_id uuid not null,
	constraint interaction_audience_members_pk
		primary key (interaction_id, membership_id),
	constraint interaction_audience_members_interaction_fk
		foreign key (interaction_id, game_id)
		references interactions (id, game_id) on delete cascade,
	constraint interaction_audience_members_membership_fk
		foreign key (membership_id, game_id)
		references game_memberships (id, game_id) on delete restrict
);

create index interaction_audience_members_member_idx
	on interaction_audience_members (game_id, membership_id, interaction_id);

create table interaction_eligible_responders (
	interaction_id uuid not null,
	game_id uuid not null,
	membership_id uuid not null,
	constraint interaction_eligible_responders_pk
		primary key (interaction_id, membership_id),
	constraint interaction_eligible_responders_interaction_fk
		foreign key (interaction_id, game_id)
		references interactions (id, game_id) on delete cascade,
	constraint interaction_eligible_responders_membership_fk
		foreign key (membership_id, game_id)
		references game_memberships (id, game_id) on delete restrict
);

create index interaction_eligible_responders_member_idx
	on interaction_eligible_responders (game_id, membership_id, interaction_id);

create table interaction_context_entities (
	interaction_id uuid not null,
	game_id uuid not null,
	entity_id uuid not null,
	label text,
	visibility text not null default 'public',
	position integer not null,
	constraint interaction_context_entities_pk
		primary key (interaction_id, entity_id),
	constraint interaction_context_entities_label_nonempty
		check (label is null or btrim(label) <> ''),
	constraint interaction_context_entities_visibility_valid
		check (visibility in ('public', 'facilitator')),
	constraint interaction_context_entities_position_nonnegative check (position >= 0),
	constraint interaction_context_entities_position_unique
		unique (interaction_id, position),
	constraint interaction_context_entities_interaction_fk
		foreign key (interaction_id, game_id)
		references interactions (id, game_id) on delete cascade,
	constraint interaction_context_entities_entity_fk
		foreign key (entity_id, game_id)
		references game_entities (entity_id, game_id) on delete restrict
);

create index interaction_context_entities_entity_idx
	on interaction_context_entities (game_id, entity_id, interaction_id);

create table interaction_action_submissions (
	id uuid primary key default gen_random_uuid(),
	interaction_id uuid not null,
	game_id uuid not null,
	submitted_by_membership_id uuid not null,
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
	constraint interaction_action_submissions_id_game_unique unique (id, game_id),
	constraint interaction_action_submissions_id_interaction_game_unique
		unique (id, interaction_id, game_id),
	constraint interaction_action_submissions_interaction_fk
		foreign key (interaction_id, game_id)
		references interactions (id, game_id) on delete cascade,
	constraint interaction_action_submissions_membership_fk
		foreign key (submitted_by_membership_id, game_id)
		references game_memberships (id, game_id) on delete restrict
);

create index interaction_action_submissions_interaction_idx
	on interaction_action_submissions (interaction_id, status, created_at, id);

create index interaction_action_submissions_member_idx
	on interaction_action_submissions (game_id, submitted_by_membership_id, created_at desc, id);

create unique index interaction_action_submissions_one_selected_unique
	on interaction_action_submissions (interaction_id)
	where status = 'selected';

create trigger interaction_action_submissions_set_updated_at
before update on interaction_action_submissions
for each row execute function set_updated_at();

create table interaction_resolutions (
	id uuid primary key default gen_random_uuid(),
	interaction_id uuid not null,
	game_id uuid not null,
	rule_set_id uuid not null,
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
	constraint interaction_resolutions_public_narrative_nonempty
		check (btrim(public_narrative) <> ''),
	constraint interaction_resolutions_public_narrative_length
		check (char_length(public_narrative) <= 20000),
	constraint interaction_resolutions_private_notes_length
		check (private_notes is null or char_length(private_notes) <= 20000),
	constraint interaction_resolutions_idempotency_key_nonempty
		check (idempotency_key is null or btrim(idempotency_key) <> ''),
	constraint interaction_resolutions_idempotency_key_length
		check (idempotency_key is null or char_length(idempotency_key) <= 200),
	constraint interaction_resolutions_status_valid
		check (status in ('draft', 'applied')),
	constraint interaction_resolutions_applied_shape check (
		(status = 'draft' and resolved_by_membership_id is null and applied_at is null and idempotency_key is null)
		or (status = 'applied' and resolved_by_membership_id is not null and applied_at is not null and idempotency_key is not null)
	),
	constraint interaction_resolutions_interaction_unique unique (interaction_id),
	constraint interaction_resolutions_id_game_unique unique (id, game_id),
	constraint interaction_resolutions_id_game_rule_set_unique unique (id, game_id, rule_set_id),
	constraint interaction_resolutions_game_rule_set_fk
		foreign key (game_id, rule_set_id)
		references games (id, rule_set_id) on delete cascade,
	constraint interaction_resolutions_interaction_fk
		foreign key (interaction_id, game_id)
		references interactions (id, game_id) on delete cascade,
	constraint interaction_resolutions_selected_submission_fk
		foreign key (selected_submission_id, interaction_id, game_id)
		references interaction_action_submissions (id, interaction_id, game_id) on delete restrict,
	constraint interaction_resolutions_created_by_membership_fk
		foreign key (created_by_membership_id, game_id)
		references game_memberships (id, game_id) on delete restrict,
	constraint interaction_resolutions_resolved_by_membership_fk
		foreign key (resolved_by_membership_id, game_id)
		references game_memberships (id, game_id) on delete restrict
);

create unique index interaction_resolutions_idempotency_unique
	on interaction_resolutions (game_id, idempotency_key)
	where idempotency_key is not null;

create trigger interaction_resolutions_set_updated_at
before update on interaction_resolutions
for each row execute function set_updated_at();

create table interaction_resolution_effects (
	id uuid primary key default gen_random_uuid(),
	resolution_id uuid not null,
	game_id uuid not null,
	rule_set_id uuid not null,
	position integer not null,
	operation text not null,
	state_variable_id uuid not null,
	adjustment_amount numeric,
	constraint interaction_resolution_effects_position_nonnegative check (position >= 0),
	constraint interaction_resolution_effects_operation_valid
		check (operation in ('set', 'clear', 'adjust-number', 'add-value', 'remove-value')),
	constraint interaction_resolution_effects_adjustment_shape check (
		(operation = 'adjust-number' and adjustment_amount is not null)
		or (operation <> 'adjust-number' and adjustment_amount is null)
	),
	constraint interaction_resolution_effects_adjustment_finite
		check (adjustment_amount is null or dnd_numeric_is_finite(adjustment_amount)),
	constraint interaction_resolution_effects_resolution_position_unique
		unique (resolution_id, position),
	constraint interaction_resolution_effects_id_game_unique unique (id, game_id),
	constraint interaction_resolution_effects_typed_identity_unique
		unique (id, resolution_id, game_id, rule_set_id, state_variable_id),
	constraint interaction_resolution_effects_resolution_fk
		foreign key (resolution_id, game_id, rule_set_id)
		references interaction_resolutions (id, game_id, rule_set_id) on delete cascade,
	constraint interaction_resolution_effects_state_variable_fk
		foreign key (state_variable_id, rule_set_id)
		references state_variable_definitions (id, rule_set_id) on delete restrict,
	constraint interaction_resolution_effects_enabled_operation_fk
		foreign key (state_variable_id, operation)
		references state_variable_effect_operations (state_variable_id, operation) on delete restrict
);

create index interaction_resolution_effects_variable_idx
	on interaction_resolution_effects (rule_set_id, state_variable_id, resolution_id, position);

create table interaction_resolution_effect_targets (
	effect_id uuid not null,
	game_id uuid not null,
	entity_id uuid not null,
	position integer not null,
	constraint interaction_resolution_effect_targets_pk primary key (effect_id, entity_id),
	constraint interaction_resolution_effect_targets_position_nonnegative check (position >= 0),
	constraint interaction_resolution_effect_targets_position_unique unique (effect_id, position),
	constraint interaction_resolution_effect_targets_effect_fk
		foreign key (effect_id, game_id)
		references interaction_resolution_effects (id, game_id) on delete cascade,
	constraint interaction_resolution_effect_targets_entity_fk
		foreign key (entity_id, game_id)
		references game_entities (entity_id, game_id) on delete restrict
);

create index interaction_resolution_effect_targets_entity_idx
	on interaction_resolution_effect_targets (game_id, entity_id, effect_id);

create table interaction_resolution_effect_operands (
	id uuid primary key default gen_random_uuid(),
	effect_id uuid not null,
	resolution_id uuid not null,
	game_id uuid not null,
	rule_set_id uuid not null,
	state_variable_id uuid not null,
	value_kind text not null,
	cardinality text not null,
	position integer not null,
	text_value text,
	number_value numeric,
	boolean_value boolean,
	choice_option_id uuid,
	measurement_amount numeric,
	measurement_unit_id uuid,
	referenced_entity_id uuid,
	fallback_name text,
	constraint interaction_resolution_effect_operands_position_nonnegative check (position >= 0),
	constraint interaction_resolution_effect_operands_single_position
		check (cardinality <> 'one' or position = 0),
	constraint interaction_resolution_effect_operands_fallback_name_nonempty
		check (fallback_name is null or btrim(fallback_name) <> ''),
	constraint interaction_resolution_effect_operands_number_finite
		check (number_value is null or dnd_numeric_is_finite(number_value)),
	constraint interaction_resolution_effect_operands_measurement_finite
		check (measurement_amount is null or dnd_numeric_is_finite(measurement_amount)),
	constraint interaction_resolution_effect_operands_typed_shape check (
		(value_kind = 'text' and text_value is not null and number_value is null and boolean_value is null and choice_option_id is null and measurement_amount is null and measurement_unit_id is null and referenced_entity_id is null and fallback_name is null)
		or (value_kind = 'number' and text_value is null and number_value is not null and boolean_value is null and choice_option_id is null and measurement_amount is null and measurement_unit_id is null and referenced_entity_id is null and fallback_name is null)
		or (value_kind = 'boolean' and text_value is null and number_value is null and boolean_value is not null and choice_option_id is null and measurement_amount is null and measurement_unit_id is null and referenced_entity_id is null and fallback_name is null)
		or (value_kind = 'choice' and text_value is null and number_value is null and boolean_value is null and choice_option_id is not null and measurement_amount is null and measurement_unit_id is null and referenced_entity_id is null and fallback_name is null)
		or (value_kind = 'measurement' and text_value is null and number_value is null and boolean_value is null and choice_option_id is null and measurement_amount is not null and measurement_unit_id is not null and referenced_entity_id is null and fallback_name is null)
		or (value_kind = 'reference' and text_value is null and number_value is null and boolean_value is null and choice_option_id is null and measurement_amount is null and measurement_unit_id is null and referenced_entity_id is not null)
	),
	constraint interaction_resolution_effect_operands_effect_position_unique unique (effect_id, position),
	constraint interaction_resolution_effect_operands_effect_fk
		foreign key (effect_id, resolution_id, game_id, rule_set_id, state_variable_id)
		references interaction_resolution_effects (id, resolution_id, game_id, rule_set_id, state_variable_id) on delete cascade,
	constraint interaction_resolution_effect_operands_variable_fk
		foreign key (state_variable_id, rule_set_id, value_kind, cardinality)
		references state_variable_definitions (id, rule_set_id, value_kind, cardinality) on delete restrict,
	constraint interaction_resolution_effect_operands_choice_option_fk
		foreign key (choice_option_id, state_variable_id)
		references state_variable_choice_options (id, state_variable_id) on delete restrict,
	constraint interaction_resolution_effect_operands_measurement_unit_fk
		foreign key (measurement_unit_id, state_variable_id)
		references state_variable_measurement_units (id, state_variable_id) on delete restrict,
	constraint interaction_resolution_effect_operands_referenced_entity_fk
		foreign key (referenced_entity_id, game_id)
		references game_entities (entity_id, game_id) on delete restrict
);

create unique index interaction_resolution_effect_operands_many_text_unique
	on interaction_resolution_effect_operands (effect_id, text_value)
	where cardinality = 'many' and value_kind = 'text';

create unique index interaction_resolution_effect_operands_many_number_unique
	on interaction_resolution_effect_operands (effect_id, number_value)
	where cardinality = 'many' and value_kind = 'number';

create unique index interaction_resolution_effect_operands_many_boolean_unique
	on interaction_resolution_effect_operands (effect_id, boolean_value)
	where cardinality = 'many' and value_kind = 'boolean';

create unique index interaction_resolution_effect_operands_many_choice_unique
	on interaction_resolution_effect_operands (effect_id, choice_option_id)
	where cardinality = 'many' and value_kind = 'choice';

create unique index interaction_resolution_effect_operands_many_measurement_unique
	on interaction_resolution_effect_operands (effect_id, measurement_amount, measurement_unit_id)
	where cardinality = 'many' and value_kind = 'measurement';

create unique index interaction_resolution_effect_operands_many_reference_unique
	on interaction_resolution_effect_operands (effect_id, referenced_entity_id)
	where cardinality = 'many' and value_kind = 'reference';

create table interaction_resolution_effect_applications (
	id uuid primary key default gen_random_uuid(),
	resolution_id uuid not null,
	effect_id uuid not null,
	game_id uuid not null,
	rule_set_id uuid not null,
	state_variable_id uuid not null,
	entity_id uuid not null,
	position integer not null,
	changed boolean not null,
	constraint interaction_resolution_effect_applications_position_nonnegative check (position >= 0),
	constraint resolution_effect_applications_position_unique
		unique (resolution_id, position),
	constraint interaction_resolution_effect_applications_effect_entity_unique
		unique (effect_id, entity_id),
	constraint resolution_effect_applications_typed_unique
		unique (id, game_id, rule_set_id, state_variable_id),
	constraint interaction_resolution_effect_applications_effect_fk
		foreign key (effect_id, resolution_id, game_id, rule_set_id, state_variable_id)
		references interaction_resolution_effects (id, resolution_id, game_id, rule_set_id, state_variable_id) on delete restrict,
	constraint interaction_resolution_effect_applications_target_fk
		foreign key (effect_id, entity_id)
		references interaction_resolution_effect_targets (effect_id, entity_id) on delete restrict,
	constraint interaction_resolution_effect_applications_entity_fk
		foreign key (entity_id, game_id)
		references game_entities (entity_id, game_id) on delete restrict
);

create index interaction_resolution_effect_applications_entity_idx
	on interaction_resolution_effect_applications (game_id, entity_id, resolution_id, position);

-- Every application owns exactly one before and one after value-set row.
-- known=false with a null cardinality represents an unknown logical value;
-- known=true with no scalar children preserves a known empty many-value.
create table interaction_resolution_application_value_sets (
	application_id uuid not null,
	phase text not null,
	game_id uuid not null,
	rule_set_id uuid not null,
	state_variable_id uuid not null,
	known boolean not null,
	cardinality text,
	constraint interaction_resolution_application_value_sets_pk
		primary key (application_id, phase),
	constraint interaction_resolution_application_value_sets_phase_valid
		check (phase in ('before', 'after')),
	constraint interaction_resolution_application_value_sets_cardinality_valid
		check (cardinality is null or cardinality in ('one', 'many')),
	constraint interaction_resolution_application_value_sets_known_shape
		check ((known and cardinality is not null) or (not known and cardinality is null)),
	constraint resolution_application_value_sets_typed_unique
		unique (application_id, phase, game_id, rule_set_id, state_variable_id, cardinality),
	constraint interaction_resolution_application_value_sets_application_fk
		foreign key (application_id, game_id, rule_set_id, state_variable_id)
		references interaction_resolution_effect_applications (id, game_id, rule_set_id, state_variable_id) on delete restrict
);

create table interaction_resolution_application_values (
	id uuid primary key default gen_random_uuid(),
	application_id uuid not null,
	phase text not null,
	game_id uuid not null,
	rule_set_id uuid not null,
	state_variable_id uuid not null,
	value_kind text not null,
	cardinality text not null,
	position integer not null,
	text_value text,
	number_value numeric,
	boolean_value boolean,
	choice_option_id uuid,
	measurement_amount numeric,
	measurement_unit_id uuid,
	referenced_entity_id uuid,
	fallback_name text,
	constraint interaction_resolution_application_values_position_nonnegative check (position >= 0),
	constraint interaction_resolution_application_values_single_position
		check (cardinality <> 'one' or position = 0),
	constraint resolution_application_values_fallback_nonempty
		check (fallback_name is null or btrim(fallback_name) <> ''),
	constraint interaction_resolution_application_values_number_finite
		check (number_value is null or dnd_numeric_is_finite(number_value)),
	constraint interaction_resolution_application_values_measurement_finite
		check (measurement_amount is null or dnd_numeric_is_finite(measurement_amount)),
	constraint interaction_resolution_application_values_typed_shape check (
		(value_kind = 'text' and text_value is not null and number_value is null and boolean_value is null and choice_option_id is null and measurement_amount is null and measurement_unit_id is null and referenced_entity_id is null and fallback_name is null)
		or (value_kind = 'number' and text_value is null and number_value is not null and boolean_value is null and choice_option_id is null and measurement_amount is null and measurement_unit_id is null and referenced_entity_id is null and fallback_name is null)
		or (value_kind = 'boolean' and text_value is null and number_value is null and boolean_value is not null and choice_option_id is null and measurement_amount is null and measurement_unit_id is null and referenced_entity_id is null and fallback_name is null)
		or (value_kind = 'choice' and text_value is null and number_value is null and boolean_value is null and choice_option_id is not null and measurement_amount is null and measurement_unit_id is null and referenced_entity_id is null and fallback_name is null)
		or (value_kind = 'measurement' and text_value is null and number_value is null and boolean_value is null and choice_option_id is null and measurement_amount is not null and measurement_unit_id is not null and referenced_entity_id is null and fallback_name is null)
		or (value_kind = 'reference' and text_value is null and number_value is null and boolean_value is null and choice_option_id is null and measurement_amount is null and measurement_unit_id is null and referenced_entity_id is not null)
	),
	constraint interaction_resolution_application_values_position_unique
		unique (application_id, phase, position),
	constraint interaction_resolution_application_values_value_set_fk
		foreign key (application_id, phase, game_id, rule_set_id, state_variable_id, cardinality)
		references interaction_resolution_application_value_sets (application_id, phase, game_id, rule_set_id, state_variable_id, cardinality) on delete restrict,
	constraint interaction_resolution_application_values_variable_fk
		foreign key (state_variable_id, rule_set_id, value_kind, cardinality)
		references state_variable_definitions (id, rule_set_id, value_kind, cardinality) on delete restrict,
	constraint interaction_resolution_application_values_choice_option_fk
		foreign key (choice_option_id, state_variable_id)
		references state_variable_choice_options (id, state_variable_id) on delete restrict,
	constraint interaction_resolution_application_values_measurement_unit_fk
		foreign key (measurement_unit_id, state_variable_id)
		references state_variable_measurement_units (id, state_variable_id) on delete restrict,
	constraint interaction_resolution_application_values_referenced_entity_fk
		foreign key (referenced_entity_id, game_id)
		references game_entities (entity_id, game_id) on delete restrict
);

create unique index interaction_resolution_application_values_many_text_unique
	on interaction_resolution_application_values (application_id, phase, text_value)
	where cardinality = 'many' and value_kind = 'text';

create unique index interaction_resolution_application_values_many_number_unique
	on interaction_resolution_application_values (application_id, phase, number_value)
	where cardinality = 'many' and value_kind = 'number';

create unique index interaction_resolution_application_values_many_boolean_unique
	on interaction_resolution_application_values (application_id, phase, boolean_value)
	where cardinality = 'many' and value_kind = 'boolean';

create unique index interaction_resolution_application_values_many_choice_unique
	on interaction_resolution_application_values (application_id, phase, choice_option_id)
	where cardinality = 'many' and value_kind = 'choice';

create unique index resolution_app_values_many_measurement_unique
	on interaction_resolution_application_values (application_id, phase, measurement_amount, measurement_unit_id)
	where cardinality = 'many' and value_kind = 'measurement';

create unique index interaction_resolution_application_values_many_reference_unique
	on interaction_resolution_application_values (application_id, phase, referenced_entity_id)
	where cardinality = 'many' and value_kind = 'reference';

-- This is a durable notification cursor, not the source of truth for game
-- state. Payloads remain normalized: clients use the typed resource IDs to
-- fetch the current authorized representation.
create table game_events (
	id bigint generated always as identity primary key,
	game_id uuid not null,
	event_type text not null,
	actor_membership_id uuid,
	interaction_id uuid,
	submission_id uuid,
	resolution_id uuid,
	created_at timestamptz not null default now(),
	constraint game_events_type_valid check (event_type in (
		'game-created',
		'game-archived',
		'membership-created',
		'membership-updated',
		'entity-assigned',
		'interaction-created',
		'interaction-updated',
		'interaction-presented',
		'interaction-adjudicating',
		'interaction-cancelled',
		'submission-created',
		'submission-withdrawn',
		'resolution-updated',
		'resolution-applied'
	)),
	constraint game_events_game_fk
		foreign key (game_id) references games (id) on delete cascade,
	constraint game_events_actor_membership_fk
		foreign key (actor_membership_id, game_id)
		references game_memberships (id, game_id) on delete restrict,
	constraint game_events_interaction_fk
		foreign key (interaction_id, game_id)
		references interactions (id, game_id) on delete restrict,
	constraint game_events_submission_fk
		foreign key (submission_id, game_id)
		references interaction_action_submissions (id, game_id) on delete restrict,
	constraint game_events_resolution_fk
		foreign key (resolution_id, game_id)
		references interaction_resolutions (id, game_id) on delete restrict
);

create index game_events_game_cursor_idx
	on game_events (game_id, id);

create function protect_final_interaction()
returns trigger
language plpgsql
as $$
begin
	if old.status in ('resolved', 'cancelled') then
		raise exception using errcode = '23514', message = 'final interactions are immutable';
	end if;
	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

create trigger interactions_protect_final
before update or delete on interactions
for each row execute function protect_final_interaction();

create function protect_applied_resolution()
returns trigger
language plpgsql
as $$
begin
	if old.status = 'applied' then
		raise exception using errcode = '23514', message = 'applied resolutions are immutable';
	end if;
	if tg_op = 'UPDATE' and new.status = 'applied' then
		if exists (
			select 1
			from interaction_resolution_effects effect
			where effect.resolution_id = new.id
				and not exists (
					select 1 from interaction_resolution_effect_targets target
					where target.effect_id = effect.id
				)
		) then
			raise exception using errcode = '23514', message = 'applied resolution effects require targets';
		end if;
		if exists (
			select 1
			from interaction_resolution_effect_targets target
			join interaction_resolution_effects effect on effect.id = target.effect_id
			where effect.resolution_id = new.id
				and not exists (
					select 1 from interaction_resolution_effect_applications application
					where application.effect_id = target.effect_id
						and application.entity_id = target.entity_id
				)
		) then
			raise exception using errcode = '23514', message = 'applied resolution targets require applications';
		end if;
		if exists (
			select 1
			from interaction_resolution_effects effect
			where effect.resolution_id = new.id
				and effect.operation in ('clear', 'adjust-number')
				and exists (
					select 1 from interaction_resolution_effect_operands operand
					where operand.effect_id = effect.id
				)
		) then
			raise exception using errcode = '23514', message = 'applied resolution effect operand shape is incomplete';
		end if;
		if exists (
			select 1
			from interaction_resolution_effects effect
			join state_variable_definitions definition on definition.id = effect.state_variable_id
			where effect.resolution_id = new.id
				and (
					(effect.operation in ('add-value', 'remove-value') and
						(select count(*) from interaction_resolution_effect_operands operand where operand.effect_id = effect.id) <> 1)
					or (effect.operation = 'set' and definition.cardinality = 'one' and
						(select count(*) from interaction_resolution_effect_operands operand where operand.effect_id = effect.id) <> 1)
				)
		) then
			raise exception using errcode = '23514', message = 'applied resolution effect operand shape is incomplete';
		end if;
		if exists (
			select 1
			from interaction_resolution_effect_applications application
			where application.resolution_id = new.id
				and (select count(*) from interaction_resolution_application_value_sets value_set
					where value_set.application_id = application.id) <> 2
		) then
			raise exception using errcode = '23514', message = 'applied resolution applications require before and after values';
		end if;
		if exists (
			select 1
			from interaction_resolution_application_value_sets value_set
			join interaction_resolution_effect_applications application
				on application.id = value_set.application_id
			join state_variable_definitions definition
				on definition.id = value_set.state_variable_id
			where application.resolution_id = new.id
				and (
					(value_set.known and value_set.cardinality <> definition.cardinality)
					or (not value_set.known and exists (
						select 1 from interaction_resolution_application_values value
						where value.application_id = value_set.application_id and value.phase = value_set.phase
					))
					or (value_set.known and value_set.cardinality = 'one' and
						(select count(*) from interaction_resolution_application_values value
						where value.application_id = value_set.application_id and value.phase = value_set.phase) <> 1)
				)
		) then
			raise exception using errcode = '23514', message = 'applied resolution application value shape is incomplete';
		end if;
	end if;
	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

create trigger interaction_resolutions_protect_applied
before update or delete on interaction_resolutions
for each row execute function protect_applied_resolution();

create function protect_resolution_owned_row()
returns trigger
language plpgsql
as $$
declare
	owned_resolution_id uuid;
	owned_resolution_status text;
begin
	if tg_op = 'UPDATE' and new.resolution_id is distinct from old.resolution_id then
		raise exception using errcode = '23514', message = 'resolution child ownership is immutable';
	end if;
	if tg_op = 'INSERT' then
		owned_resolution_id := new.resolution_id;
	else
		owned_resolution_id := old.resolution_id;
	end if;
	select status into owned_resolution_status
	from interaction_resolutions
	where id = owned_resolution_id
	for update;
	if owned_resolution_status = 'applied' then
		raise exception using errcode = '23514', message = 'applied resolution children are immutable';
	end if;
	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

create trigger interaction_resolution_effects_protect_applied
before insert or update or delete on interaction_resolution_effects
for each row execute function protect_resolution_owned_row();

create trigger interaction_resolution_effect_applications_protect_applied
before insert or update or delete on interaction_resolution_effect_applications
for each row execute function protect_resolution_owned_row();

create function protect_effect_owned_row()
returns trigger
language plpgsql
as $$
declare
	owned_effect_id uuid;
	owned_resolution_status text;
begin
	if tg_op = 'UPDATE' and new.effect_id is distinct from old.effect_id then
		raise exception using errcode = '23514', message = 'effect child ownership is immutable';
	end if;
	if tg_op = 'INSERT' then
		owned_effect_id := new.effect_id;
	else
		owned_effect_id := old.effect_id;
	end if;
	select resolution.status into owned_resolution_status
	from interaction_resolution_effects effect
	join interaction_resolutions resolution on resolution.id = effect.resolution_id
	where effect.id = owned_effect_id
	for update of resolution;
	if owned_resolution_status = 'applied' then
		raise exception using errcode = '23514', message = 'applied resolution children are immutable';
	end if;
	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

create trigger interaction_resolution_effect_targets_protect_applied
before insert or update or delete on interaction_resolution_effect_targets
for each row execute function protect_effect_owned_row();

create trigger interaction_resolution_effect_operands_protect_applied
before insert or update or delete on interaction_resolution_effect_operands
for each row execute function protect_effect_owned_row();

create function protect_application_owned_row()
returns trigger
language plpgsql
as $$
declare
	owned_application_id uuid;
	owned_resolution_status text;
begin
	if tg_op = 'UPDATE' and new.application_id is distinct from old.application_id then
		raise exception using errcode = '23514', message = 'application value ownership is immutable';
	end if;
	if tg_op = 'INSERT' then
		owned_application_id := new.application_id;
	else
		owned_application_id := old.application_id;
	end if;
	select resolution.status into owned_resolution_status
	from interaction_resolution_effect_applications application
	join interaction_resolutions resolution on resolution.id = application.resolution_id
	where application.id = owned_application_id
	for update of resolution;
	if owned_resolution_status = 'applied' then
		raise exception using errcode = '23514', message = 'applied resolution receipts are immutable';
	end if;
	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

create trigger interaction_resolution_application_value_sets_protect_applied
before insert or update or delete on interaction_resolution_application_value_sets
for each row execute function protect_application_owned_row();

create trigger interaction_resolution_application_values_protect_applied
before insert or update or delete on interaction_resolution_application_values
for each row execute function protect_application_owned_row();

create function protect_game_event()
returns trigger
language plpgsql
as $$
begin
	raise exception using errcode = '23514', message = 'game events are immutable';
end;
$$;

create trigger game_events_protect_immutable
before update or delete on game_events
for each row execute function protect_game_event();
