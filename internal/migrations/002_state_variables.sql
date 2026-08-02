create function dnd_numeric_is_finite(value numeric)
returns boolean
language sql
immutable
returns null on null input
as $$
	select value::text not in ('NaN', 'Infinity', '-Infinity')
$$;

create table state_variable_definitions (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	key text not null,
	label text not null,
	description text,
	presentation_group text,
	value_kind text not null,
	cardinality text not null,
	missing_kind text not null,
	omit_default_when_stored boolean not null default false,
	condition_addressable boolean not null default false,
	display_order integer not null default 0,
	presentation_control text,
	presentation_help_text text,
	number_minimum numeric,
	number_maximum numeric,
	number_step numeric,
	number_unit text,
	measurement_minimum numeric,
	measurement_maximum numeric,
	measurement_step numeric,
	archived boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint state_variable_definitions_key_nonempty check (btrim(key) <> ''),
	constraint state_variable_definitions_label_nonempty check (btrim(label) <> ''),
	constraint state_variable_definitions_presentation_group_nonempty
		check (presentation_group is null or btrim(presentation_group) <> ''),
	constraint state_variable_definitions_presentation_help_text_nonempty
		check (presentation_help_text is null or btrim(presentation_help_text) <> ''),
	constraint state_variable_definitions_number_unit_nonempty
		check (number_unit is null or btrim(number_unit) <> ''),
	constraint state_variable_definitions_value_kind_valid
		check (value_kind in ('text', 'choice', 'measurement', 'number', 'boolean', 'reference')),
	constraint state_variable_definitions_cardinality_valid
		check (cardinality in ('one', 'many')),
	constraint state_variable_definitions_missing_kind_valid
		check (missing_kind in ('unknown', 'default')),
	constraint state_variable_definitions_omit_default_valid
		check (not omit_default_when_stored or missing_kind = 'default'),
	constraint state_variable_definitions_display_order_nonnegative check (display_order >= 0),
	constraint state_variable_definitions_presentation_control_valid
		check (
			presentation_control is null
			or presentation_control in (
				'short-text', 'long-text', 'select', 'measurement', 'number', 'checkbox', 'reference-picker'
			)
		),
	constraint state_variable_definitions_number_metadata_kind check (
		value_kind = 'number'
		or (
			number_minimum is null
			and number_maximum is null
			and number_step is null
			and number_unit is null
		)
	),
	constraint state_variable_definitions_measurement_metadata_kind check (
		value_kind = 'measurement'
		or (
			measurement_minimum is null
			and measurement_maximum is null
			and measurement_step is null
		)
	),
	constraint state_variable_definitions_number_minimum_finite
		check (number_minimum is null or dnd_numeric_is_finite(number_minimum)),
	constraint state_variable_definitions_number_maximum_finite
		check (number_maximum is null or dnd_numeric_is_finite(number_maximum)),
	constraint state_variable_definitions_number_step_valid
		check (number_step is null or (dnd_numeric_is_finite(number_step) and number_step > 0)),
	constraint state_variable_definitions_number_bounds_ordered
		check (number_minimum is null or number_maximum is null or number_minimum <= number_maximum),
	constraint state_variable_definitions_measurement_minimum_finite
		check (measurement_minimum is null or dnd_numeric_is_finite(measurement_minimum)),
	constraint state_variable_definitions_measurement_maximum_finite
		check (measurement_maximum is null or dnd_numeric_is_finite(measurement_maximum)),
	constraint state_variable_definitions_measurement_step_valid
		check (
			measurement_step is null
			or (dnd_numeric_is_finite(measurement_step) and measurement_step > 0)
		),
	constraint state_variable_definitions_measurement_bounds_ordered
		check (
			measurement_minimum is null
			or measurement_maximum is null
			or measurement_minimum <= measurement_maximum
		),
	constraint state_variable_definitions_rule_set_key_unique unique (rule_set_id, key),
	constraint state_variable_definitions_id_rule_set_unique unique (id, rule_set_id),
	constraint state_variable_definitions_typed_identity_unique
		unique (id, rule_set_id, value_kind, cardinality),
	constraint state_variable_definitions_rule_set_fk
		foreign key (rule_set_id) references rule_sets (id) on delete cascade
);

create index state_variable_definitions_rule_set_idx
	on state_variable_definitions (rule_set_id, archived, display_order, label, id);

create trigger state_variable_definitions_set_updated_at
before update on state_variable_definitions
for each row execute function set_updated_at();

create table state_variable_owner_schemas (
	state_variable_id uuid not null,
	rule_set_id uuid not null,
	owner_schema_id uuid not null,
	constraint state_variable_owner_schemas_pk primary key (state_variable_id, owner_schema_id),
	constraint state_variable_owner_schemas_variable_fk
		foreign key (state_variable_id, rule_set_id)
		references state_variable_definitions (id, rule_set_id) on delete cascade,
	constraint state_variable_owner_schemas_owner_schema_fk
		foreign key (owner_schema_id, rule_set_id)
		references state_owner_schemas (id, rule_set_id) on delete restrict
);

create index state_variable_owner_schemas_schema_idx
	on state_variable_owner_schemas (rule_set_id, owner_schema_id, state_variable_id);

create table state_variable_choice_options (
	id uuid primary key default gen_random_uuid(),
	state_variable_id uuid not null,
	key text not null,
	label text not null,
	position integer not null,
	constraint state_variable_choice_options_key_nonempty check (btrim(key) <> ''),
	constraint state_variable_choice_options_label_nonempty check (btrim(label) <> ''),
	constraint state_variable_choice_options_position_nonnegative check (position >= 0),
	constraint state_variable_choice_options_variable_key_unique unique (state_variable_id, key),
	constraint state_variable_choice_options_variable_position_unique unique (state_variable_id, position),
	constraint state_variable_choice_options_id_variable_unique unique (id, state_variable_id),
	constraint state_variable_choice_options_variable_fk
		foreign key (state_variable_id) references state_variable_definitions (id) on delete cascade
);

create table state_variable_measurement_units (
	id uuid primary key default gen_random_uuid(),
	state_variable_id uuid not null,
	unit text not null,
	position integer not null,
	constraint state_variable_measurement_units_unit_nonempty check (btrim(unit) <> ''),
	constraint state_variable_measurement_units_position_nonnegative check (position >= 0),
	constraint state_variable_measurement_units_variable_unit_unique unique (state_variable_id, unit),
	constraint state_variable_measurement_units_variable_position_unique unique (state_variable_id, position),
	constraint state_variable_measurement_units_id_variable_unique unique (id, state_variable_id),
	constraint state_variable_measurement_units_variable_fk
		foreign key (state_variable_id) references state_variable_definitions (id) on delete cascade
);

create table state_variable_reference_target_schemas (
	state_variable_id uuid not null,
	rule_set_id uuid not null,
	owner_schema_id uuid not null,
	constraint state_variable_reference_target_schemas_pk primary key (state_variable_id, owner_schema_id),
	constraint state_variable_reference_target_schemas_variable_fk
		foreign key (state_variable_id, rule_set_id)
		references state_variable_definitions (id, rule_set_id) on delete cascade,
	constraint state_variable_reference_target_schemas_owner_schema_fk
		foreign key (owner_schema_id, rule_set_id)
		references state_owner_schemas (id, rule_set_id) on delete restrict
);

create index state_variable_reference_target_schemas_schema_idx
	on state_variable_reference_target_schemas (rule_set_id, owner_schema_id, state_variable_id);

create table state_variable_effect_operations (
	state_variable_id uuid not null,
	operation text not null,
	constraint state_variable_effect_operations_pk primary key (state_variable_id, operation),
	constraint state_variable_effect_operations_operation_valid
		check (operation in ('set', 'clear', 'adjust-number', 'add-value', 'remove-value')),
	constraint state_variable_effect_operations_variable_fk
		foreign key (state_variable_id) references state_variable_definitions (id) on delete cascade
);

create table state_variable_default_values (
	id uuid primary key default gen_random_uuid(),
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
	constraint state_variable_default_values_position_nonnegative check (position >= 0),
	constraint state_variable_default_values_single_position
		check (cardinality <> 'one' or position = 0),
	constraint state_variable_default_values_fallback_name_nonempty
		check (fallback_name is null or btrim(fallback_name) <> ''),
	constraint state_variable_default_values_number_finite
		check (number_value is null or dnd_numeric_is_finite(number_value)),
	constraint state_variable_default_values_measurement_finite
		check (measurement_amount is null or dnd_numeric_is_finite(measurement_amount)),
	constraint state_variable_default_values_typed_shape check (
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
	constraint state_variable_default_values_variable_position_unique unique (state_variable_id, position),
	constraint state_variable_default_values_variable_fk
		foreign key (state_variable_id, rule_set_id, value_kind, cardinality)
		references state_variable_definitions (id, rule_set_id, value_kind, cardinality) on delete cascade,
	constraint state_variable_default_values_choice_option_fk
		foreign key (choice_option_id, state_variable_id)
		references state_variable_choice_options (id, state_variable_id) on delete restrict,
	constraint state_variable_default_values_measurement_unit_fk
		foreign key (measurement_unit_id, state_variable_id)
		references state_variable_measurement_units (id, state_variable_id) on delete restrict,
	constraint state_variable_default_values_referenced_entity_fk
		foreign key (referenced_entity_id, rule_set_id)
		references entities (id, rule_set_id) on delete restrict
);

create unique index state_variable_default_values_one_unique
	on state_variable_default_values (state_variable_id)
	where cardinality = 'one';

create unique index state_variable_default_values_many_text_unique
	on state_variable_default_values (state_variable_id, text_value)
	where cardinality = 'many' and value_kind = 'text';

create unique index state_variable_default_values_many_number_unique
	on state_variable_default_values (state_variable_id, number_value)
	where cardinality = 'many' and value_kind = 'number';

create unique index state_variable_default_values_many_boolean_unique
	on state_variable_default_values (state_variable_id, boolean_value)
	where cardinality = 'many' and value_kind = 'boolean';

create unique index state_variable_default_values_many_choice_unique
	on state_variable_default_values (state_variable_id, choice_option_id)
	where cardinality = 'many' and value_kind = 'choice';

create unique index state_variable_default_values_many_measurement_unique
	on state_variable_default_values (state_variable_id, measurement_amount, measurement_unit_id)
	where cardinality = 'many' and value_kind = 'measurement';

create unique index state_variable_default_values_many_reference_unique
	on state_variable_default_values (state_variable_id, referenced_entity_id)
	where cardinality = 'many' and value_kind = 'reference';
