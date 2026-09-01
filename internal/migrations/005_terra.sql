alter table worlds
	add column facilitator_source text not null default 'human';

alter table worlds
	add constraint worlds_facilitator_source_valid
	check (facilitator_source in ('human', 'terra'));
