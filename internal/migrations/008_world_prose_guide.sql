alter table worlds
	add column prose_guide text;

alter table worlds
	add constraint worlds_prose_guide_length
		check (prose_guide is null or char_length(prose_guide) <= 10000);
