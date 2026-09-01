alter table worlds
	add column facilitator_membership_id uuid;

update worlds world
set facilitator_membership_id = (
	select membership.id
	from world_memberships membership
	where membership.world_id = world.id
		and membership.role = 'owner'
	order by case membership.status when 'active' then 0 else 1 end,
		membership.joined_at, membership.id
	limit 1
)
where world.facilitator_source = 'human';

alter table worlds
	add constraint worlds_facilitator_assignment_shape check (
		(facilitator_source = 'human' and facilitator_membership_id is not null)
		or (facilitator_source = 'terra' and facilitator_membership_id is null)
	),
	add constraint worlds_facilitator_membership_fk
		foreign key (facilitator_membership_id, id)
		references world_memberships (id, world_id)
		on delete restrict
		deferrable initially deferred;

alter table interactions
	add column facilitator_source text not null default 'human',
	alter column created_by_membership_id drop not null,
	add constraint interactions_facilitator_source_valid
		check (facilitator_source in ('human', 'terra')),
	add constraint interactions_facilitator_actor_shape check (
		(facilitator_source = 'human' and created_by_membership_id is not null)
		or (facilitator_source = 'terra' and created_by_membership_id is null)
	);

alter table interaction_resolutions
	drop constraint interaction_resolutions_committed_shape,
	add column facilitator_source text not null default 'human',
	alter column created_by_membership_id drop not null,
	add constraint interaction_resolutions_facilitator_source_valid
		check (facilitator_source in ('human', 'terra')),
	add constraint interaction_resolutions_created_actor_shape check (
		(facilitator_source = 'human' and created_by_membership_id is not null)
		or (facilitator_source = 'terra' and created_by_membership_id is null)
	),
	add constraint interaction_resolutions_committed_shape check (
		(status = 'building' and resolved_by_membership_id is null and resolved_at is null and idempotency_key is null)
		or (
			status = 'committed' and resolved_at is not null and idempotency_key is not null
			and (
				(facilitator_source = 'human' and resolved_by_membership_id is not null)
				or (facilitator_source = 'terra' and resolved_by_membership_id is null)
			)
		)
	);

alter table world_events
	drop constraint world_events_type_valid,
	add column actor_source text not null default 'human',
	add constraint world_events_actor_source_valid
		check (actor_source in ('human', 'terra')),
	add constraint world_events_actor_shape check (
		(actor_source = 'human' and actor_membership_id is not null)
		or (actor_source = 'terra' and actor_membership_id is null)
	),
	add constraint world_events_type_valid check (event_type in (
		'world-created', 'world-archived', 'membership-created', 'membership-updated',
		'entity-created', 'entity-control-updated', 'entity-profile-updated',
		'character-fields-updated', 'interaction-created', 'interaction-updated',
		'interaction-presented', 'interaction-adjudicating', 'interaction-cancelled',
		'action-submitted', 'action-withdrawn', 'resolution-committed',
		'rules-updated', 'facilitator-changed'
	));
