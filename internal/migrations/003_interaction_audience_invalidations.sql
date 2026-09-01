alter table world_events
	add column invalidates_interaction_audience boolean not null default false,
	add constraint world_events_audience_invalidation_shape check (
		not invalidates_interaction_audience
		or (
			interaction_id is not null
			and action_id is null
			and resolution_id is null
			and event_type in ('interaction-adjudicating', 'interaction-cancelled')
		)
	);
