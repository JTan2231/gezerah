create table problem_instances (
	entity_id uuid primary key,
	rule_set_id uuid not null,
	problem_definition_id uuid not null,
	binding_revision bigint not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint problem_instances_binding_revision_nonnegative check (binding_revision >= 0),
	constraint problem_instances_entity_rule_set_unique unique (entity_id, rule_set_id),
	constraint problem_instances_entity_fk
		foreign key (entity_id, rule_set_id)
		references entities (id, rule_set_id) on delete cascade,
	constraint problem_instances_problem_definition_fk
		foreign key (problem_definition_id, rule_set_id)
		references problem_definitions (id, rule_set_id) on delete restrict
);

create index problem_instances_definition_idx
	on problem_instances (rule_set_id, problem_definition_id, created_at, entity_id);

create trigger problem_instances_set_updated_at
before update on problem_instances
for each row execute function set_updated_at();

create table problem_instance_target_bindings (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	problem_instance_id uuid not null,
	target_definition_id uuid not null,
	entity_id uuid not null,
	position integer not null,
	constraint problem_instance_target_bindings_position_nonnegative check (position >= 0),
	constraint problem_instance_target_bindings_entity_unique
		unique (problem_instance_id, target_definition_id, entity_id),
	constraint problem_instance_target_bindings_position_unique
		unique (problem_instance_id, target_definition_id, position),
	constraint problem_instance_target_bindings_instance_fk
		foreign key (problem_instance_id, rule_set_id)
		references problem_instances (entity_id, rule_set_id) on delete cascade,
	constraint problem_instance_target_bindings_target_fk
		foreign key (target_definition_id, rule_set_id)
		references problem_target_definitions (id, rule_set_id) on delete restrict,
	constraint problem_instance_target_bindings_entity_fk
		foreign key (entity_id, rule_set_id)
		references entities (id, rule_set_id) on delete restrict
);

create index problem_instance_target_bindings_target_idx
	on problem_instance_target_bindings (rule_set_id, target_definition_id, problem_instance_id);

create index problem_instance_target_bindings_entity_idx
	on problem_instance_target_bindings (rule_set_id, entity_id, problem_instance_id);
