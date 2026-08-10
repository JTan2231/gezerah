alter table worlds
	add column dm_source text not null default 'human';

alter table worlds
	add constraint worlds_dm_source_valid
	check (dm_source in ('human', 'terra'));
