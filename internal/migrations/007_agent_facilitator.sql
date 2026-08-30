alter table worlds
	drop constraint worlds_facilitator_source_valid,
	drop constraint worlds_facilitator_assignment_shape,
	add constraint worlds_facilitator_source_valid
		check (facilitator_source in ('human', 'terra', 'agent')),
	add constraint worlds_facilitator_assignment_shape check (
		(facilitator_source = 'human' and facilitator_membership_id is not null)
		or (facilitator_source in ('terra', 'agent') and facilitator_membership_id is null)
	);

alter table interactions
	drop constraint interactions_facilitator_source_valid,
	drop constraint interactions_facilitator_actor_shape,
	add constraint interactions_facilitator_source_valid
		check (facilitator_source in ('human', 'terra', 'agent')),
	add constraint interactions_facilitator_actor_shape check (
		(facilitator_source = 'human' and created_by_membership_id is not null)
		or (facilitator_source in ('terra', 'agent') and created_by_membership_id is null)
	);

alter table interaction_resolutions
	drop constraint interaction_resolutions_facilitator_source_valid,
	drop constraint interaction_resolutions_created_actor_shape,
	drop constraint interaction_resolutions_committed_shape,
	add constraint interaction_resolutions_facilitator_source_valid
		check (facilitator_source in ('human', 'terra', 'agent')),
	add constraint interaction_resolutions_created_actor_shape check (
		(facilitator_source = 'human' and created_by_membership_id is not null)
		or (facilitator_source in ('terra', 'agent') and created_by_membership_id is null)
	),
	add constraint interaction_resolutions_committed_shape check (
		(status = 'building' and resolved_by_membership_id is null and resolved_at is null and idempotency_key is null)
		or (
			status = 'committed' and resolved_at is not null and idempotency_key is not null
			and (
				(facilitator_source = 'human' and resolved_by_membership_id is not null)
				or (facilitator_source in ('terra', 'agent') and resolved_by_membership_id is null)
			)
		)
	);

alter table world_events
	drop constraint world_events_actor_source_valid,
	drop constraint world_events_actor_shape,
	add constraint world_events_actor_source_valid
		check (actor_source in ('human', 'terra', 'agent')),
	add constraint world_events_actor_shape check (
		(actor_source = 'human' and actor_membership_id is not null)
		or (actor_source in ('terra', 'agent') and actor_membership_id is null)
	);
