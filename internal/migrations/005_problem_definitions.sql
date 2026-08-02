create table problem_definitions (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	key text not null,
	name text not null,
	description text,
	available_condition_invocation_id uuid,
	archived boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint problem_definitions_key_nonempty check (btrim(key) <> ''),
	constraint problem_definitions_name_nonempty check (btrim(name) <> ''),
	constraint problem_definitions_rule_set_key_unique unique (rule_set_id, key),
	constraint problem_definitions_id_rule_set_unique unique (id, rule_set_id),
	constraint problem_definitions_rule_set_fk
		foreign key (rule_set_id) references rule_sets (id) on delete cascade
);

create index problem_definitions_rule_set_idx
	on problem_definitions (rule_set_id, archived, name, id);

create trigger problem_definitions_set_updated_at
before update on problem_definitions
for each row execute function set_updated_at();

create table problem_definition_instance_owner_schemas (
	problem_definition_id uuid not null,
	rule_set_id uuid not null,
	owner_schema_id uuid not null,
	constraint problem_definition_instance_owner_schemas_pk
		primary key (problem_definition_id, owner_schema_id),
	constraint problem_definition_instance_owner_schemas_problem_fk
		foreign key (problem_definition_id, rule_set_id)
		references problem_definitions (id, rule_set_id) on delete cascade,
	constraint problem_definition_instance_owner_schemas_owner_schema_fk
		foreign key (owner_schema_id, rule_set_id)
		references state_owner_schemas (id, rule_set_id) on delete restrict
);

create index problem_definition_instance_owner_schemas_schema_idx
	on problem_definition_instance_owner_schemas (rule_set_id, owner_schema_id, problem_definition_id);

create table problem_target_definitions (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	problem_definition_id uuid not null,
	key text not null,
	label text not null,
	description text,
	cardinality text not null,
	minimum_bindings integer not null,
	maximum_bindings integer,
	binding_source text not null,
	position integer not null,
	constraint problem_target_definitions_key_nonempty check (btrim(key) <> ''),
	constraint problem_target_definitions_label_nonempty check (btrim(label) <> ''),
	constraint problem_target_definitions_cardinality_valid check (cardinality in ('one', 'many')),
	constraint problem_target_definitions_minimum_nonnegative check (minimum_bindings >= 0),
	constraint problem_target_definitions_maximum_valid
		check (maximum_bindings is null or maximum_bindings >= minimum_bindings),
	constraint problem_target_definitions_singular_maximum
		check (cardinality <> 'one' or maximum_bindings = 1),
	constraint problem_target_definitions_binding_source_valid
		check (binding_source in ('supplied', 'problem-instance')),
	constraint problem_target_definitions_instance_source_shape check (
		binding_source <> 'problem-instance'
		or (cardinality = 'one' and minimum_bindings = 1 and maximum_bindings = 1)
	),
	constraint problem_target_definitions_position_nonnegative check (position >= 0),
	constraint problem_target_definitions_problem_key_unique unique (problem_definition_id, key),
	constraint problem_target_definitions_problem_position_unique unique (problem_definition_id, position),
	constraint problem_target_definitions_id_rule_set_unique unique (id, rule_set_id),
	constraint problem_target_definitions_id_problem_rule_set_unique
		unique (id, problem_definition_id, rule_set_id),
	constraint problem_target_definitions_problem_fk
		foreign key (problem_definition_id, rule_set_id)
		references problem_definitions (id, rule_set_id) on delete cascade
);

create unique index problem_target_definitions_one_instance_source_unique
	on problem_target_definitions (problem_definition_id)
	where binding_source = 'problem-instance';

create table problem_target_required_owner_schemas (
	target_definition_id uuid not null,
	rule_set_id uuid not null,
	owner_schema_id uuid not null,
	constraint problem_target_required_owner_schemas_pk
		primary key (target_definition_id, owner_schema_id),
	constraint problem_target_required_owner_schemas_target_fk
		foreign key (target_definition_id, rule_set_id)
		references problem_target_definitions (id, rule_set_id) on delete cascade,
	constraint problem_target_required_owner_schemas_owner_schema_fk
		foreign key (owner_schema_id, rule_set_id)
		references state_owner_schemas (id, rule_set_id) on delete restrict
);

create index problem_target_required_owner_schemas_schema_idx
	on problem_target_required_owner_schemas (rule_set_id, owner_schema_id, target_definition_id);

create table condition_invocations (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	problem_definition_id uuid not null,
	condition_set_id uuid not null,
	constraint condition_invocations_id_rule_set_unique unique (id, rule_set_id),
	constraint condition_invocations_id_problem_rule_set_unique
		unique (id, problem_definition_id, rule_set_id),
	constraint condition_invocations_problem_fk
		foreign key (problem_definition_id, rule_set_id)
		references problem_definitions (id, rule_set_id) on delete cascade,
	constraint condition_invocations_condition_set_fk
		foreign key (condition_set_id, rule_set_id)
		references condition_sets (id, rule_set_id) on delete restrict
);

create index condition_invocations_condition_set_idx
	on condition_invocations (rule_set_id, condition_set_id, problem_definition_id, id);

create table condition_invocation_arguments (
	condition_invocation_id uuid not null,
	rule_set_id uuid not null,
	condition_parameter_id uuid not null,
	target_definition_id uuid not null,
	constraint condition_invocation_arguments_pk
		primary key (condition_invocation_id, condition_parameter_id),
	constraint condition_invocation_arguments_invocation_fk
		foreign key (condition_invocation_id, rule_set_id)
		references condition_invocations (id, rule_set_id) on delete cascade,
	constraint condition_invocation_arguments_parameter_fk
		foreign key (condition_parameter_id, rule_set_id)
		references condition_parameters (id, rule_set_id) on delete restrict,
	constraint condition_invocation_arguments_target_fk
		foreign key (target_definition_id, rule_set_id)
		references problem_target_definitions (id, rule_set_id)
		deferrable initially deferred
);

create index condition_invocation_arguments_target_idx
	on condition_invocation_arguments (rule_set_id, target_definition_id, condition_invocation_id);

alter table problem_definitions
	add constraint problem_definitions_available_invocation_fk
	foreign key (available_condition_invocation_id, id, rule_set_id)
	references condition_invocations (id, problem_definition_id, rule_set_id)
	deferrable initially deferred;

create table problem_choices (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	problem_definition_id uuid not null,
	key text not null,
	name text not null,
	description text,
	position integer not null,
	available_condition_invocation_id uuid,
	constraint problem_choices_key_nonempty check (btrim(key) <> ''),
	constraint problem_choices_name_nonempty check (btrim(name) <> ''),
	constraint problem_choices_position_nonnegative check (position >= 0),
	constraint problem_choices_problem_key_unique unique (problem_definition_id, key),
	constraint problem_choices_problem_position_unique unique (problem_definition_id, position),
	constraint problem_choices_id_rule_set_unique unique (id, rule_set_id),
	constraint problem_choices_id_problem_rule_set_unique unique (id, problem_definition_id, rule_set_id),
	constraint problem_choices_problem_fk
		foreign key (problem_definition_id, rule_set_id)
		references problem_definitions (id, rule_set_id) on delete cascade,
	constraint problem_choices_available_invocation_fk
		foreign key (available_condition_invocation_id, problem_definition_id, rule_set_id)
		references condition_invocations (id, problem_definition_id, rule_set_id)
		deferrable initially deferred
);

create table choice_resolutions (
	choice_id uuid primary key,
	rule_set_id uuid not null,
	resolution_type text not null,
	condition_invocation_id uuid,
	constraint choice_resolutions_type_valid
		check (resolution_type in ('automatic', 'condition')),
	constraint choice_resolutions_invocation_shape check (
		(resolution_type = 'automatic' and condition_invocation_id is null)
		or (resolution_type = 'condition' and condition_invocation_id is not null)
	),
	constraint choice_resolutions_choice_fk
		foreign key (choice_id, rule_set_id)
		references problem_choices (id, rule_set_id) on delete cascade,
	constraint choice_resolutions_condition_invocation_fk
		foreign key (condition_invocation_id, rule_set_id)
		references condition_invocations (id, rule_set_id)
		deferrable initially deferred
);

create table choice_outcomes (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	choice_id uuid not null,
	branch text not null,
	label text not null,
	constraint choice_outcomes_branch_valid check (branch in ('automatic', 'met', 'unmet')),
	constraint choice_outcomes_label_nonempty check (btrim(label) <> ''),
	constraint choice_outcomes_choice_branch_unique unique (choice_id, branch),
	constraint choice_outcomes_id_rule_set_unique unique (id, rule_set_id),
	constraint choice_outcomes_choice_fk
		foreign key (choice_id, rule_set_id)
		references problem_choices (id, rule_set_id) on delete cascade
);

create table consequence_sets (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	outcome_id uuid not null,
	constraint consequence_sets_outcome_unique unique (outcome_id),
	constraint consequence_sets_id_rule_set_unique unique (id, rule_set_id),
	constraint consequence_sets_outcome_fk
		foreign key (outcome_id, rule_set_id)
		references choice_outcomes (id, rule_set_id) on delete cascade
);

create table effects (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	consequence_set_id uuid not null,
	position integer not null,
	operation text not null,
	target_definition_id uuid not null,
	state_variable_id uuid not null,
	adjustment_amount numeric,
	constraint effects_position_nonnegative check (position >= 0),
	constraint effects_operation_valid
		check (operation in ('set', 'clear', 'adjust-number', 'add-value', 'remove-value')),
	constraint effects_adjustment_shape check (
		(operation = 'adjust-number' and adjustment_amount is not null)
		or (operation <> 'adjust-number' and adjustment_amount is null)
	),
	constraint effects_adjustment_finite
		check (adjustment_amount is null or dnd_numeric_is_finite(adjustment_amount)),
	constraint effects_consequence_position_unique unique (consequence_set_id, position),
	constraint effects_id_variable_rule_set_unique unique (id, state_variable_id, rule_set_id),
	constraint effects_consequence_set_fk
		foreign key (consequence_set_id, rule_set_id)
		references consequence_sets (id, rule_set_id) on delete cascade,
	constraint effects_target_definition_fk
		foreign key (target_definition_id, rule_set_id)
		references problem_target_definitions (id, rule_set_id)
		deferrable initially deferred,
	constraint effects_state_variable_fk
		foreign key (state_variable_id, rule_set_id)
		references state_variable_definitions (id, rule_set_id) on delete restrict,
	constraint effects_enabled_operation_fk
		foreign key (state_variable_id, operation)
		references state_variable_effect_operations (state_variable_id, operation) on delete restrict
);

create index effects_target_usage_idx
	on effects (rule_set_id, target_definition_id, id);

create index effects_variable_usage_idx
	on effects (rule_set_id, state_variable_id, id);

create table effect_value_operands (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	effect_id uuid not null,
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
	constraint effect_value_operands_position_nonnegative check (position >= 0),
	constraint effect_value_operands_single_position check (cardinality <> 'one' or position = 0),
	constraint effect_value_operands_fallback_name_nonempty
		check (fallback_name is null or btrim(fallback_name) <> ''),
	constraint effect_value_operands_number_finite
		check (number_value is null or dnd_numeric_is_finite(number_value)),
	constraint effect_value_operands_measurement_finite
		check (measurement_amount is null or dnd_numeric_is_finite(measurement_amount)),
	constraint effect_value_operands_typed_shape check (
		(
			value_kind = 'text'
			and text_value is not null
			and number_value is null
			and boolean_value is null
			and choice_option_id is null
			and measurement_amount is null
			and measurement_unit_id is null
			and referenced_entity_id is null
			and fallback_name is null
		)
		or (
			value_kind = 'number'
			and text_value is null
			and number_value is not null
			and boolean_value is null
			and choice_option_id is null
			and measurement_amount is null
			and measurement_unit_id is null
			and referenced_entity_id is null
			and fallback_name is null
		)
		or (
			value_kind = 'boolean'
			and text_value is null
			and number_value is null
			and boolean_value is not null
			and choice_option_id is null
			and measurement_amount is null
			and measurement_unit_id is null
			and referenced_entity_id is null
			and fallback_name is null
		)
		or (
			value_kind = 'choice'
			and text_value is null
			and number_value is null
			and boolean_value is null
			and choice_option_id is not null
			and measurement_amount is null
			and measurement_unit_id is null
			and referenced_entity_id is null
			and fallback_name is null
		)
		or (
			value_kind = 'measurement'
			and text_value is null
			and number_value is null
			and boolean_value is null
			and choice_option_id is null
			and measurement_amount is not null
			and measurement_unit_id is not null
			and referenced_entity_id is null
			and fallback_name is null
		)
		or (
			value_kind = 'reference'
			and text_value is null
			and number_value is null
			and boolean_value is null
			and choice_option_id is null
			and measurement_amount is null
			and measurement_unit_id is null
			and referenced_entity_id is not null
		)
	),
	constraint effect_value_operands_effect_position_unique unique (effect_id, position),
	constraint effect_value_operands_effect_fk
		foreign key (effect_id, state_variable_id, rule_set_id)
		references effects (id, state_variable_id, rule_set_id) on delete cascade,
	constraint effect_value_operands_variable_fk
		foreign key (state_variable_id, rule_set_id, value_kind, cardinality)
		references state_variable_definitions (id, rule_set_id, value_kind, cardinality) on delete restrict,
	constraint effect_value_operands_choice_option_fk
		foreign key (choice_option_id, state_variable_id)
		references state_variable_choice_options (id, state_variable_id) on delete restrict,
	constraint effect_value_operands_measurement_unit_fk
		foreign key (measurement_unit_id, state_variable_id)
		references state_variable_measurement_units (id, state_variable_id) on delete restrict,
	constraint effect_value_operands_referenced_entity_fk
		foreign key (referenced_entity_id, rule_set_id)
		references entities (id, rule_set_id) on delete restrict
);

create unique index effect_value_operands_many_text_unique
	on effect_value_operands (effect_id, text_value)
	where cardinality = 'many' and value_kind = 'text';

create unique index effect_value_operands_many_number_unique
	on effect_value_operands (effect_id, number_value)
	where cardinality = 'many' and value_kind = 'number';

create unique index effect_value_operands_many_boolean_unique
	on effect_value_operands (effect_id, boolean_value)
	where cardinality = 'many' and value_kind = 'boolean';

create unique index effect_value_operands_many_choice_unique
	on effect_value_operands (effect_id, choice_option_id)
	where cardinality = 'many' and value_kind = 'choice';

create unique index effect_value_operands_many_measurement_unique
	on effect_value_operands (effect_id, measurement_amount, measurement_unit_id)
	where cardinality = 'many' and value_kind = 'measurement';

create unique index effect_value_operands_many_reference_unique
	on effect_value_operands (effect_id, referenced_entity_id)
	where cardinality = 'many' and value_kind = 'reference';
