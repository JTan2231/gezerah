create table state_values (
	id uuid primary key default gen_random_uuid(),
	owner_entity_id uuid not null,
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
	constraint state_values_position_nonnegative check (position >= 0),
	constraint state_values_single_position check (cardinality <> 'one' or position = 0),
	constraint state_values_fallback_name_nonempty
		check (fallback_name is null or btrim(fallback_name) <> ''),
	constraint state_values_number_finite
		check (number_value is null or dnd_numeric_is_finite(number_value)),
	constraint state_values_measurement_finite
		check (measurement_amount is null or dnd_numeric_is_finite(measurement_amount)),
	constraint state_values_typed_shape check (
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
	constraint state_values_owner_variable_position_unique
		unique (owner_entity_id, state_variable_id, position),
	constraint state_values_owner_record_fk
		foreign key (owner_entity_id, rule_set_id)
		references state_records (owner_entity_id, rule_set_id) on delete cascade,
	constraint state_values_variable_fk
		foreign key (state_variable_id, rule_set_id, value_kind, cardinality)
		references state_variable_definitions (id, rule_set_id, value_kind, cardinality) on delete restrict,
	constraint state_values_choice_option_fk
		foreign key (choice_option_id, state_variable_id)
		references state_variable_choice_options (id, state_variable_id) on delete restrict,
	constraint state_values_measurement_unit_fk
		foreign key (measurement_unit_id, state_variable_id)
		references state_variable_measurement_units (id, state_variable_id) on delete restrict,
	constraint state_values_referenced_entity_fk
		foreign key (referenced_entity_id, rule_set_id)
		references entities (id, rule_set_id) on delete restrict
);

create index state_values_variable_usage_idx
	on state_values (rule_set_id, state_variable_id, owner_entity_id);

create unique index state_values_one_unique
	on state_values (owner_entity_id, state_variable_id)
	where cardinality = 'one';

create unique index state_values_many_text_unique
	on state_values (owner_entity_id, state_variable_id, text_value)
	where cardinality = 'many' and value_kind = 'text';

create unique index state_values_many_number_unique
	on state_values (owner_entity_id, state_variable_id, number_value)
	where cardinality = 'many' and value_kind = 'number';

create unique index state_values_many_boolean_unique
	on state_values (owner_entity_id, state_variable_id, boolean_value)
	where cardinality = 'many' and value_kind = 'boolean';

create unique index state_values_many_choice_unique
	on state_values (owner_entity_id, state_variable_id, choice_option_id)
	where cardinality = 'many' and value_kind = 'choice';

create unique index state_values_many_measurement_unique
	on state_values (owner_entity_id, state_variable_id, measurement_amount, measurement_unit_id)
	where cardinality = 'many' and value_kind = 'measurement';

create unique index state_values_many_reference_unique
	on state_values (owner_entity_id, state_variable_id, referenced_entity_id)
	where cardinality = 'many' and value_kind = 'reference';
