create table condition_sets (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	key text not null,
	name text not null,
	description text,
	archived boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint condition_sets_key_nonempty check (btrim(key) <> ''),
	constraint condition_sets_name_nonempty check (btrim(name) <> ''),
	constraint condition_sets_rule_set_key_unique unique (rule_set_id, key),
	constraint condition_sets_id_rule_set_unique unique (id, rule_set_id),
	constraint condition_sets_rule_set_fk
		foreign key (rule_set_id) references rule_sets (id) on delete cascade
);

create index condition_sets_rule_set_idx
	on condition_sets (rule_set_id, archived, name, id);

create trigger condition_sets_set_updated_at
before update on condition_sets
for each row execute function set_updated_at();

create table condition_parameters (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	condition_set_id uuid not null,
	key text not null,
	label text not null,
	cardinality text not null,
	position integer not null,
	constraint condition_parameters_key_nonempty check (btrim(key) <> ''),
	constraint condition_parameters_label_nonempty check (btrim(label) <> ''),
	constraint condition_parameters_cardinality_valid check (cardinality in ('one', 'many')),
	constraint condition_parameters_position_nonnegative check (position >= 0),
	constraint condition_parameters_set_key_unique unique (condition_set_id, key),
	constraint condition_parameters_set_position_unique unique (condition_set_id, position),
	constraint condition_parameters_id_rule_set_unique unique (id, rule_set_id),
	constraint condition_parameters_id_set_rule_set_unique unique (id, condition_set_id, rule_set_id),
	constraint condition_parameters_condition_set_fk
		foreign key (condition_set_id, rule_set_id)
		references condition_sets (id, rule_set_id) on delete cascade
);

create table condition_parameter_required_owner_schemas (
	condition_parameter_id uuid not null,
	rule_set_id uuid not null,
	owner_schema_id uuid not null,
	constraint condition_parameter_required_owner_schemas_pk
		primary key (condition_parameter_id, owner_schema_id),
	constraint condition_parameter_required_owner_schemas_parameter_fk
		foreign key (condition_parameter_id, rule_set_id)
		references condition_parameters (id, rule_set_id) on delete cascade,
	constraint condition_parameter_required_owner_schemas_owner_schema_fk
		foreign key (owner_schema_id, rule_set_id)
		references state_owner_schemas (id, rule_set_id) on delete restrict
);

create index condition_parameter_required_owner_schemas_schema_idx
	on condition_parameter_required_owner_schemas (rule_set_id, owner_schema_id, condition_parameter_id);

create table condition_expression_nodes (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	condition_set_id uuid not null,
	parent_node_id uuid,
	position integer not null,
	node_type text not null,
	required_count integer,
	constraint condition_expression_nodes_position_nonnegative check (position >= 0),
	constraint condition_expression_nodes_node_type_valid
		check (node_type in ('all', 'any', 'at-least', 'criterion')),
	constraint condition_expression_nodes_required_count_shape check (
		(node_type = 'at-least' and required_count is not null and required_count > 0)
		or (node_type <> 'at-least' and required_count is null)
	),
	constraint condition_expression_nodes_not_own_parent check (parent_node_id is null or parent_node_id <> id),
	constraint condition_expression_nodes_sibling_position_unique
		unique (condition_set_id, parent_node_id, position),
	constraint condition_expression_nodes_id_set_rule_set_unique
		unique (id, condition_set_id, rule_set_id),
	constraint condition_expression_nodes_condition_set_fk
		foreign key (condition_set_id, rule_set_id)
		references condition_sets (id, rule_set_id) on delete cascade,
	constraint condition_expression_nodes_parent_fk
		foreign key (parent_node_id, condition_set_id, rule_set_id)
		references condition_expression_nodes (id, condition_set_id, rule_set_id)
		on delete cascade
		deferrable initially deferred
);

create unique index condition_expression_nodes_one_root_unique
	on condition_expression_nodes (condition_set_id)
	where parent_node_id is null;

create index condition_expression_nodes_parent_idx
	on condition_expression_nodes (condition_set_id, parent_node_id, position, id);

create table condition_criteria (
	expression_node_id uuid primary key,
	condition_set_id uuid not null,
	rule_set_id uuid not null,
	condition_parameter_id uuid not null,
	state_variable_id uuid not null,
	quantifier text not null,
	required_count integer,
	operator text not null,
	constraint condition_criteria_quantifier_valid
		check (quantifier in ('single', 'any', 'all', 'at-least')),
	constraint condition_criteria_required_count_shape check (
		(quantifier = 'at-least' and required_count is not null and required_count > 0)
		or (quantifier <> 'at-least' and required_count is null)
	),
	constraint condition_criteria_operator_valid
		check (operator in ('eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is', 'one-of')),
	constraint condition_criteria_expression_node_fk
		foreign key (expression_node_id, condition_set_id, rule_set_id)
		references condition_expression_nodes (id, condition_set_id, rule_set_id) on delete cascade,
	constraint condition_criteria_parameter_fk
		foreign key (condition_parameter_id, condition_set_id, rule_set_id)
		references condition_parameters (id, condition_set_id, rule_set_id)
		deferrable initially deferred,
	constraint condition_criteria_state_variable_fk
		foreign key (state_variable_id, rule_set_id)
		references state_variable_definitions (id, rule_set_id) on delete restrict
);

create index condition_criteria_parameter_idx
	on condition_criteria (rule_set_id, condition_parameter_id, expression_node_id);

create index condition_criteria_state_variable_idx
	on condition_criteria (rule_set_id, state_variable_id, expression_node_id);

create table condition_number_predicates (
	criterion_node_id uuid primary key,
	value numeric,
	minimum numeric,
	maximum numeric,
	constraint condition_number_predicates_operand_shape check (
		(value is not null and minimum is null and maximum is null)
		or (value is null and minimum is not null and maximum is not null)
	),
	constraint condition_number_predicates_value_finite
		check (value is null or dnd_numeric_is_finite(value)),
	constraint condition_number_predicates_minimum_finite
		check (minimum is null or dnd_numeric_is_finite(minimum)),
	constraint condition_number_predicates_maximum_finite
		check (maximum is null or dnd_numeric_is_finite(maximum)),
	constraint condition_number_predicates_bounds_ordered
		check (minimum is null or maximum is null or minimum <= maximum),
	constraint condition_number_predicates_criterion_fk
		foreign key (criterion_node_id) references condition_criteria (expression_node_id) on delete cascade
);

create table condition_boolean_predicates (
	criterion_node_id uuid primary key,
	value boolean not null,
	constraint condition_boolean_predicates_criterion_fk
		foreign key (criterion_node_id) references condition_criteria (expression_node_id) on delete cascade
);

create table condition_choice_operands (
	criterion_node_id uuid not null,
	choice_option_id uuid not null,
	position integer not null,
	constraint condition_choice_operands_pk primary key (criterion_node_id, position),
	constraint condition_choice_operands_position_nonnegative check (position >= 0),
	constraint condition_choice_operands_option_unique unique (criterion_node_id, choice_option_id),
	constraint condition_choice_operands_criterion_fk
		foreign key (criterion_node_id) references condition_criteria (expression_node_id) on delete cascade,
	constraint condition_choice_operands_choice_option_fk
		foreign key (choice_option_id) references state_variable_choice_options (id) on delete restrict
);
