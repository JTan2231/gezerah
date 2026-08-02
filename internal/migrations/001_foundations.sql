create extension if not exists pgcrypto;

create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

create table rule_sets (
	id uuid primary key default gen_random_uuid(),
	key text not null,
	name text not null,
	description text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint rule_sets_key_nonempty check (btrim(key) <> ''),
	constraint rule_sets_name_nonempty check (btrim(name) <> ''),
	constraint rule_sets_key_unique unique (key)
);

create trigger rule_sets_set_updated_at
before update on rule_sets
for each row execute function set_updated_at();

create table state_owner_schemas (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	key text not null,
	label text not null,
	description text,
	archived boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint state_owner_schemas_key_nonempty check (btrim(key) <> ''),
	constraint state_owner_schemas_label_nonempty check (btrim(label) <> ''),
	constraint state_owner_schemas_rule_set_key_unique unique (rule_set_id, key),
	constraint state_owner_schemas_id_rule_set_unique unique (id, rule_set_id),
	constraint state_owner_schemas_rule_set_fk
		foreign key (rule_set_id) references rule_sets (id) on delete cascade
);

create index state_owner_schemas_rule_set_idx
	on state_owner_schemas (rule_set_id, archived, label, id);

create trigger state_owner_schemas_set_updated_at
before update on state_owner_schemas
for each row execute function set_updated_at();

create table entities (
	id uuid primary key default gen_random_uuid(),
	rule_set_id uuid not null,
	key text,
	display_name text not null,
	archived boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint entities_key_nonempty check (key is null or btrim(key) <> ''),
	constraint entities_display_name_nonempty check (btrim(display_name) <> ''),
	constraint entities_rule_set_key_unique unique (rule_set_id, key),
	constraint entities_id_rule_set_unique unique (id, rule_set_id),
	constraint entities_rule_set_fk
		foreign key (rule_set_id) references rule_sets (id) on delete cascade
);

create index entities_rule_set_idx
	on entities (rule_set_id, archived, display_name, id);

create trigger entities_set_updated_at
before update on entities
for each row execute function set_updated_at();

create table entity_owner_schemas (
	entity_id uuid not null,
	rule_set_id uuid not null,
	owner_schema_id uuid not null,
	constraint entity_owner_schemas_pk primary key (entity_id, owner_schema_id),
	constraint entity_owner_schemas_entity_fk
		foreign key (entity_id, rule_set_id)
		references entities (id, rule_set_id) on delete cascade,
	constraint entity_owner_schemas_owner_schema_fk
		foreign key (owner_schema_id, rule_set_id)
		references state_owner_schemas (id, rule_set_id) on delete restrict
);

create index entity_owner_schemas_owner_schema_idx
	on entity_owner_schemas (rule_set_id, owner_schema_id, entity_id);

create table state_records (
	owner_entity_id uuid primary key,
	rule_set_id uuid not null,
	revision bigint not null default 0,
	updated_at timestamptz not null default now(),
	constraint state_records_revision_nonnegative check (revision >= 0),
	constraint state_records_owner_rule_set_unique unique (owner_entity_id, rule_set_id),
	constraint state_records_owner_entity_fk
		foreign key (owner_entity_id, rule_set_id)
		references entities (id, rule_set_id) on delete cascade
);

create index state_records_rule_set_idx
	on state_records (rule_set_id, owner_entity_id);

create trigger state_records_set_updated_at
before update on state_records
for each row execute function set_updated_at();
