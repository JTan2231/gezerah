create table world_mechanic_graphs (
	world_id uuid primary key,
	revision bigint not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_mechanic_graphs_revision_nonnegative check (revision >= 0),
	constraint world_mechanic_graphs_world_fk foreign key (world_id)
		references worlds (id) on delete cascade
);

insert into world_mechanic_graphs (world_id)
select id from worlds;

create trigger world_mechanic_graphs_set_updated_at before update on world_mechanic_graphs
for each row execute function set_updated_at();

create function create_world_mechanic_graph() returns trigger language plpgsql as $$
begin
	insert into world_mechanic_graphs (world_id) values (new.id);
	return new;
end;
$$;

create trigger worlds_create_mechanic_graph after insert on worlds
for each row execute function create_world_mechanic_graph();

alter table world_mechanics
	add column source_kind text not null default 'input';

alter table world_mechanics
	drop constraint world_mechanics_numeric_shape,
	add constraint world_mechanics_source_kind_valid
		check (source_kind in ('input', 'derived')),
	add constraint world_mechanics_source_shape check (
		(source_kind = 'input' and (
			(value_kind = 'boolean' and minimum is null and maximum is null and step is null
				and default_number is null and unit is null)
			or (value_kind = 'number' and default_number is not null)
		))
		or (source_kind = 'derived' and minimum is null and maximum is null and step is null
			and default_number is null and mutable_during_play = false
			and (value_kind = 'number' or unit is null))
	),
	add constraint world_mechanics_id_world_value_source_unique
		unique (id, world_id, value_kind, source_kind);

alter table entity_input_value_overrides
	add column mechanic_source_kind text not null default 'input',
	drop constraint entity_input_value_overrides_mechanic_fk,
	add constraint entity_input_value_overrides_mechanic_source_input
		check (mechanic_source_kind = 'input'),
	add constraint entity_input_value_overrides_mechanic_fk
		foreign key (mechanic_id, world_id, value_kind, mechanic_source_kind)
		references world_mechanics (id, world_id, value_kind, source_kind) on delete restrict;

create table world_mechanic_expression_nodes (
	id uuid primary key default gen_random_uuid(),
	world_id uuid not null,
	mechanic_id uuid not null,
	mechanic_value_kind text not null,
	mechanic_source_kind text not null default 'derived',
	parent_node_id uuid,
	position integer not null,
	operation text not null,
	value_kind text not null,
	number_value numeric,
	boolean_value boolean,
	referenced_mechanic_id uuid,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint world_mechanic_expression_nodes_position_nonnegative check (position >= 0),
	constraint world_mechanic_expression_nodes_value_kind_valid
		check (value_kind in ('number', 'boolean')),
	constraint world_mechanic_expression_nodes_derived_owner
		check (mechanic_source_kind = 'derived'),
	constraint world_mechanic_expression_nodes_not_own_parent
		check (parent_node_id is null or parent_node_id <> id),
	constraint world_mechanic_expression_nodes_root_shape
		check (parent_node_id is not null or (position = 0 and value_kind = mechanic_value_kind)),
	constraint world_mechanic_expression_nodes_operation_valid check (operation in (
		'literal', 'mechanic-reference',
		'add-number', 'subtract-number', 'multiply-number', 'min-number', 'max-number',
		'negate-number', 'and', 'or', 'not', 'equal', 'less-than',
		'less-than-or-equal', 'greater-than', 'greater-than-or-equal', 'if'
	)),
	constraint world_mechanic_expression_nodes_operand_shape check (
		(operation = 'literal' and referenced_mechanic_id is null and (
			(value_kind = 'number' and number_value is not null and boolean_value is null)
			or (value_kind = 'boolean' and number_value is null and boolean_value is not null)
		))
		or (operation = 'mechanic-reference' and referenced_mechanic_id is not null
			and number_value is null and boolean_value is null)
		or (operation not in ('literal', 'mechanic-reference') and referenced_mechanic_id is null
			and number_value is null and boolean_value is null)
	),
	constraint world_mechanic_expression_nodes_result_shape check (
		(operation in (
			'add-number', 'subtract-number', 'multiply-number', 'min-number', 'max-number',
			'negate-number'
		) and value_kind = 'number')
		or (operation in (
			'and', 'or', 'not', 'equal', 'less-than', 'less-than-or-equal',
			'greater-than', 'greater-than-or-equal'
		) and value_kind = 'boolean')
		or operation in ('literal', 'mechanic-reference', 'if')
	),
	constraint world_mechanic_expression_nodes_id_mechanic_world_unique
		unique (id, mechanic_id, world_id),
	constraint world_mechanic_expression_nodes_parent_position_unique
		unique (mechanic_id, parent_node_id, position),
	constraint world_mechanic_expression_nodes_owner_fk
		foreign key (mechanic_id, world_id, mechanic_value_kind, mechanic_source_kind)
		references world_mechanics (id, world_id, value_kind, source_kind) on delete cascade,
	constraint world_mechanic_expression_nodes_parent_fk
		foreign key (parent_node_id, mechanic_id, world_id)
		references world_mechanic_expression_nodes (id, mechanic_id, world_id)
		on delete cascade deferrable initially deferred,
	constraint world_mechanic_expression_nodes_reference_fk
		foreign key (referenced_mechanic_id, world_id, value_kind)
		references world_mechanics (id, world_id, value_kind) on delete restrict
);

create unique index world_mechanic_expression_nodes_one_root_unique
	on world_mechanic_expression_nodes (world_id, mechanic_id)
	where parent_node_id is null;
create index world_mechanic_expression_nodes_parent_idx
	on world_mechanic_expression_nodes (world_id, mechanic_id, parent_node_id, position);
create index world_mechanic_expression_nodes_reference_idx
	on world_mechanic_expression_nodes (world_id, referenced_mechanic_id, mechanic_id)
	where referenced_mechanic_id is not null;
create trigger world_mechanic_expression_nodes_set_updated_at
	before update on world_mechanic_expression_nodes
	for each row execute function set_updated_at();

create table entity_status_sets (
	entity_id uuid primary key,
	world_id uuid not null,
	revision bigint not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint entity_status_sets_revision_nonnegative check (revision >= 0),
	constraint entity_status_sets_id_world_unique unique (entity_id, world_id),
	constraint entity_status_sets_entity_fk foreign key (entity_id, world_id)
		references entities (id, world_id) on delete cascade
);

insert into entity_status_sets (entity_id, world_id)
select id, world_id from entities;

create index entity_status_sets_world_idx on entity_status_sets (world_id, entity_id);
create trigger entity_status_sets_set_updated_at before update on entity_status_sets
for each row execute function set_updated_at();

create function create_entity_status_set() returns trigger language plpgsql as $$
begin
	insert into entity_status_sets (entity_id, world_id) values (new.id, new.world_id);
	return new;
end;
$$;

create trigger entities_create_status_set after insert on entities
for each row execute function create_entity_status_set();

alter table interaction_resolutions
	add column rules_revision bigint;

update interaction_resolutions resolution
set rules_revision = mechanic_graph.revision
from world_mechanic_graphs mechanic_graph
where mechanic_graph.world_id = resolution.world_id;

alter table interaction_resolutions
	alter column rules_revision set not null,
	add constraint interaction_resolutions_rules_revision_nonnegative check (rules_revision >= 0);

alter table interaction_resolution_effects
	drop constraint interaction_resolution_effects_operation_valid,
	drop constraint interaction_resolution_effects_operand_shape,
	drop constraint interaction_resolution_effects_mechanic_fk,
	alter column mechanic_id drop not null,
	alter column value_kind drop not null,
	add column status_name text,
	add column status_description text,
	add constraint interaction_resolution_effects_operation_valid
		check (operation in ('set', 'adjust-number', 'apply-status', 'remove-status')),
	add constraint interaction_resolution_effects_status_name_nonempty
		check (status_name is null or btrim(status_name) <> ''),
	add constraint interaction_resolution_effects_status_name_length
		check (status_name is null or char_length(status_name) <= 200),
	add constraint interaction_resolution_effects_status_description_length
		check (status_description is null or char_length(status_description) <= 2000),
	add constraint interaction_resolution_effects_operand_shape check (
		(operation = 'adjust-number' and mechanic_id is not null
			and value_kind = 'number' and adjustment_amount is not null
			and set_number is null and set_boolean is null
			and status_name is null and status_description is null)
		or (operation = 'set' and mechanic_id is not null
			and adjustment_amount is null and (
				(value_kind = 'number' and set_number is not null and set_boolean is null)
				or (value_kind = 'boolean' and set_number is null and set_boolean is not null)
			) and status_name is null and status_description is null)
		or (operation = 'apply-status' and mechanic_id is null and value_kind is null
			and set_number is null and set_boolean is null and adjustment_amount is null
			and status_name is not null)
		or (operation = 'remove-status' and mechanic_id is null and value_kind is null
			and set_number is null and set_boolean is null and adjustment_amount is null
			and status_name is null and status_description is null)
	),
	add constraint interaction_resolution_effects_mechanic_fk
		foreign key (mechanic_id, world_id, value_kind)
		references world_mechanics (id, world_id, value_kind) on delete restrict,
	add constraint interaction_resolution_effects_id_resolution_world_operation_unique
		unique (id, resolution_id, world_id, operation);

alter table interaction_resolution_effect_targets
	drop constraint interaction_resolution_effect_targets_effect_fk,
	add column effect_operation text,
	add column status_instance_id uuid;

update interaction_resolution_effect_targets target
set effect_operation = effect.operation
from interaction_resolution_effects effect
where effect.id = target.effect_id and effect.resolution_id = target.resolution_id
	and effect.world_id = target.world_id;

alter table interaction_resolution_effect_targets
	alter column effect_operation set not null,
	add constraint interaction_resolution_effect_targets_operation_valid
		check (effect_operation in ('set', 'adjust-number', 'apply-status', 'remove-status')),
	add constraint interaction_resolution_effect_targets_status_shape check (
		(effect_operation = 'remove-status' and status_instance_id is not null)
		or (effect_operation <> 'remove-status' and status_instance_id is null)
	),
	add constraint interaction_resolution_effect_targets_effect_fk
		foreign key (effect_id, resolution_id, world_id, effect_operation)
		references interaction_resolution_effects (id, resolution_id, world_id, operation)
		on delete cascade,
	add constraint interaction_resolution_effect_targets_effect_entity_receipt_unique
		unique (effect_id, entity_id, resolution_id, world_id, effect_operation),
	add constraint interaction_resolution_effect_targets_status_receipt_unique
		unique (effect_id, entity_id, resolution_id, world_id, effect_operation, status_instance_id);

create table interaction_resolution_inline_status_modifiers (
	id uuid primary key default gen_random_uuid(),
	effect_id uuid not null,
	resolution_id uuid not null,
	world_id uuid not null,
	effect_operation text not null default 'apply-status',
	position integer not null,
	priority integer not null default 0,
	operation text not null,
	mechanic_id uuid not null,
	value_kind text not null,
	number_value numeric,
	boolean_value boolean,
	created_at timestamptz not null default now(),
	constraint interaction_resolution_inline_status_modifiers_apply_owner
		check (effect_operation = 'apply-status'),
	constraint interaction_resolution_inline_status_modifiers_position_nonnegative check (position >= 0),
	constraint interaction_resolution_inline_status_modifiers_operation_valid
		check (operation in ('set', 'add-number', 'multiply-number')),
	constraint interaction_resolution_inline_status_modifiers_value_shape check (
		(operation = 'set' and (
			(value_kind = 'number' and number_value is not null and boolean_value is null)
			or (value_kind = 'boolean' and number_value is null and boolean_value is not null)
		))
		or (operation in ('add-number', 'multiply-number') and value_kind = 'number'
			and number_value is not null and boolean_value is null)
	),
	constraint interaction_resolution_inline_status_modifiers_effect_position_unique
		unique (effect_id, position),
	constraint interaction_resolution_inline_status_modifiers_id_effect_resolution_world_unique
		unique (id, effect_id, resolution_id, world_id),
	constraint interaction_resolution_inline_status_modifiers_effect_fk
		foreign key (effect_id, resolution_id, world_id, effect_operation)
		references interaction_resolution_effects (id, resolution_id, world_id, operation)
		on delete cascade,
	constraint interaction_resolution_inline_status_modifiers_mechanic_fk
		foreign key (mechanic_id, world_id, value_kind)
		references world_mechanics (id, world_id, value_kind) on delete restrict
);

create index interaction_resolution_inline_status_modifiers_mechanic_idx
	on interaction_resolution_inline_status_modifiers (world_id, mechanic_id, effect_id);

create table entity_status_instances (
	id uuid primary key default gen_random_uuid(),
	world_id uuid not null,
	entity_id uuid not null,
	source_resolution_id uuid not null,
	source_effect_id uuid not null,
	source_effect_operation text not null default 'apply-status',
	status_name text not null,
	status_description text,
	status text not null default 'active',
	applied_order bigint generated always as identity,
	applied_at timestamptz not null default now(),
	removed_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint entity_status_instances_source_apply
		check (source_effect_operation = 'apply-status'),
	constraint entity_status_instances_name_nonempty check (btrim(status_name) <> ''),
	constraint entity_status_instances_name_length check (char_length(status_name) <= 200),
	constraint entity_status_instances_description_length
		check (status_description is null or char_length(status_description) <= 2000),
	constraint entity_status_instances_status_valid check (status in ('active', 'removed')),
	constraint entity_status_instances_applied_order_positive check (applied_order > 0),
	constraint entity_status_instances_lifecycle_shape check (
		(status = 'active' and removed_at is null)
		or (status = 'removed' and removed_at is not null and removed_at >= applied_at)
	),
	constraint entity_status_instances_applied_order_unique unique (applied_order),
	constraint entity_status_instances_id_world_unique unique (id, world_id),
	constraint entity_status_instances_id_entity_world_unique unique (id, entity_id, world_id),
	constraint entity_status_instances_entity_source_effect_unique unique (entity_id, source_effect_id),
	constraint entity_status_instances_status_set_fk foreign key (entity_id, world_id)
		references entity_status_sets (entity_id, world_id) on delete cascade,
	constraint entity_status_instances_source_target_fk
		foreign key (source_effect_id, entity_id, source_resolution_id, world_id, source_effect_operation)
		references interaction_resolution_effect_targets
			(effect_id, entity_id, resolution_id, world_id, effect_operation)
		on delete restrict deferrable initially deferred
);

create index entity_status_instances_entity_idx
	on entity_status_instances (world_id, entity_id, status, applied_order, id);
create index entity_status_instances_source_idx
	on entity_status_instances (world_id, source_resolution_id, source_effect_id, entity_id);
create trigger entity_status_instances_set_updated_at before update on entity_status_instances
for each row execute function set_updated_at();

alter table interaction_resolution_effect_targets
	add constraint interaction_resolution_effect_targets_status_instance_fk
		foreign key (status_instance_id, entity_id, world_id)
		references entity_status_instances (id, entity_id, world_id) on delete restrict;

create table entity_status_instance_modifiers (
	id uuid primary key default gen_random_uuid(),
	status_instance_id uuid not null,
	world_id uuid not null,
	entity_id uuid not null,
	source_resolution_id uuid not null,
	source_effect_id uuid not null,
	source_modifier_id uuid not null,
	position integer not null,
	priority integer not null,
	operation text not null,
	mechanic_id uuid not null,
	value_kind text not null,
	number_value numeric,
	boolean_value boolean,
	created_at timestamptz not null default now(),
	constraint entity_status_instance_modifiers_position_nonnegative check (position >= 0),
	constraint entity_status_instance_modifiers_operation_valid
		check (operation in ('set', 'add-number', 'multiply-number')),
	constraint entity_status_instance_modifiers_value_shape check (
		(operation = 'set' and (
			(value_kind = 'number' and number_value is not null and boolean_value is null)
			or (value_kind = 'boolean' and number_value is null and boolean_value is not null)
		))
		or (operation in ('add-number', 'multiply-number') and value_kind = 'number'
			and number_value is not null and boolean_value is null)
	),
	constraint entity_status_instance_modifiers_instance_position_unique
		unique (status_instance_id, position),
	constraint entity_status_instance_modifiers_id_instance_world_unique
		unique (id, status_instance_id, world_id),
	constraint entity_status_instance_modifiers_instance_fk
		foreign key (status_instance_id, entity_id, world_id)
		references entity_status_instances (id, entity_id, world_id) on delete cascade,
	constraint entity_status_instance_modifiers_source_fk
		foreign key (source_modifier_id, source_effect_id, source_resolution_id, world_id)
		references interaction_resolution_inline_status_modifiers
			(id, effect_id, resolution_id, world_id)
		on delete restrict deferrable initially deferred,
	constraint entity_status_instance_modifiers_mechanic_fk
		foreign key (mechanic_id, world_id, value_kind)
		references world_mechanics (id, world_id, value_kind) on delete restrict
);

create index entity_status_instance_modifiers_mechanic_idx
	on entity_status_instance_modifiers (world_id, entity_id, mechanic_id, status_instance_id);
create trigger entity_status_instance_modifiers_protect_immutable
	before update or delete on entity_status_instance_modifiers
	for each row execute function reject_change();

create table interaction_resolution_status_applications (
	id uuid primary key default gen_random_uuid(),
	resolution_id uuid not null,
	effect_id uuid not null,
	world_id uuid not null,
	entity_id uuid not null,
	status_name text not null,
	status_instance_id uuid not null,
	target_status_instance_id uuid,
	position integer not null,
	operation text not null,
	changed boolean not null,
	before_active boolean not null,
	after_active boolean not null,
	constraint interaction_resolution_status_applications_position_nonnegative
		check (position >= 0),
	constraint interaction_resolution_status_applications_operation_valid
		check (operation in ('apply-status', 'remove-status')),
	constraint interaction_resolution_status_applications_name_nonempty
		check (btrim(status_name) <> ''),
	constraint interaction_resolution_status_applications_name_length
		check (char_length(status_name) <= 200),
	constraint interaction_resolution_status_applications_change_shape
		check (changed = (before_active <> after_active)),
	constraint interaction_resolution_status_applications_direction_shape check (
		(operation = 'apply-status' and not before_active and after_active
			and target_status_instance_id is null)
		or (operation = 'remove-status' and before_active and not after_active
			and target_status_instance_id = status_instance_id)
	),
	constraint interaction_resolution_status_applications_effect_entity_unique
		unique (effect_id, entity_id),
	constraint interaction_resolution_status_applications_resolution_position_unique
		unique (resolution_id, position),
	constraint interaction_resolution_status_applications_effect_fk
		foreign key (effect_id, resolution_id, world_id, operation)
		references interaction_resolution_effects
			(id, resolution_id, world_id, operation) on delete cascade,
	constraint interaction_resolution_status_applications_target_fk
		foreign key (effect_id, entity_id, resolution_id, world_id, operation)
		references interaction_resolution_effect_targets
			(effect_id, entity_id, resolution_id, world_id, effect_operation) on delete cascade,
	constraint interaction_resolution_status_applications_remove_target_fk
		foreign key (effect_id, entity_id, resolution_id, world_id, operation, target_status_instance_id)
		references interaction_resolution_effect_targets
			(effect_id, entity_id, resolution_id, world_id, effect_operation, status_instance_id)
		on delete cascade,
	constraint interaction_resolution_status_applications_entity_fk
		foreign key (entity_id, world_id)
		references entities (id, world_id) on delete restrict,
	constraint interaction_resolution_status_applications_instance_fk
		foreign key (status_instance_id, entity_id, world_id)
		references entity_status_instances (id, entity_id, world_id)
		on delete restrict
);

create index interaction_resolution_status_applications_entity_idx
	on interaction_resolution_status_applications (world_id, entity_id, resolution_id);
create index interaction_resolution_status_applications_instance_idx
	on interaction_resolution_status_applications (world_id, status_instance_id, resolution_id)
	where status_instance_id is not null;

create table interaction_resolution_effective_changes (
	id uuid primary key default gen_random_uuid(),
	resolution_id uuid not null,
	world_id uuid not null,
	entity_id uuid not null,
	mechanic_id uuid not null,
	value_kind text not null,
	position integer not null,
	before_number numeric,
	before_boolean boolean,
	after_number numeric,
	after_boolean boolean,
	constraint interaction_resolution_effective_changes_position_nonnegative check (position >= 0),
	constraint interaction_resolution_effective_changes_value_shape check (
		(value_kind = 'number' and before_number is not null and before_boolean is null
			and after_number is not null and after_boolean is null
			and before_number <> after_number)
		or (value_kind = 'boolean' and before_number is null and before_boolean is not null
			and after_number is null and after_boolean is not null
			and before_boolean <> after_boolean)
	),
	constraint interaction_resolution_effective_changes_resolution_entity_mechanic_unique
		unique (resolution_id, entity_id, mechanic_id),
	constraint interaction_resolution_effective_changes_resolution_position_unique
		unique (resolution_id, position),
	constraint interaction_resolution_effective_changes_resolution_fk
		foreign key (resolution_id, world_id)
		references interaction_resolutions (id, world_id) on delete cascade,
	constraint interaction_resolution_effective_changes_entity_fk
		foreign key (entity_id, world_id)
		references entities (id, world_id) on delete restrict,
	constraint interaction_resolution_effective_changes_mechanic_fk
		foreign key (mechanic_id, world_id, value_kind)
		references world_mechanics (id, world_id, value_kind) on delete restrict
);

create index interaction_resolution_effective_changes_entity_idx
	on interaction_resolution_effective_changes (world_id, entity_id, resolution_id);

alter table world_events
	drop constraint world_events_type_valid,
	add constraint world_events_type_valid check (event_type in (
		'world-created', 'world-archived', 'membership-created', 'membership-updated',
		'entity-created', 'entity-control-updated', 'entity-profile-updated',
		'character-fields-updated', 'rules-updated', 'interaction-created', 'interaction-updated',
		'interaction-presented', 'interaction-adjudicating', 'interaction-cancelled',
		'action-submitted', 'action-withdrawn', 'resolution-committed'
));

create trigger interaction_resolution_status_applications_protect_committed
	before update or delete on interaction_resolution_status_applications
	for each row execute function protect_committed_resolution_tree();
create trigger interaction_resolution_inline_status_modifiers_protect_committed
	before update or delete on interaction_resolution_inline_status_modifiers
	for each row execute function protect_committed_resolution_tree();
create trigger interaction_resolution_effective_changes_protect_committed
	before update or delete on interaction_resolution_effective_changes
	for each row execute function protect_committed_resolution_tree();
