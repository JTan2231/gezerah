package app

func (s *Server) registerResourceRoutes() {
	s.api.HandleFunc("GET /api/users", s.handleListUsers)
	s.api.HandleFunc("POST /api/users", s.handleCreateUser)

	s.api.HandleFunc("GET /api/worlds", s.handleListWorlds)
	s.api.HandleFunc("POST /api/worlds", s.handleCreateWorld)
	s.api.HandleFunc("GET /api/worlds/{world_id}", s.handleGetWorld)
	s.api.HandleFunc("PATCH /api/worlds/{world_id}", s.handleUpdateWorld)
	s.api.HandleFunc("POST /api/worlds/{world_id}/archive", s.handleArchiveWorld)
	s.api.HandleFunc("GET /api/worlds/{world_id}/members", s.handleListWorldMembers)

	s.api.HandleFunc("GET /api/worlds/{world_id}/invites", s.handleListWorldInvites)
	s.api.HandleFunc("POST /api/worlds/{world_id}/invites", s.handleCreateWorldInvite)
	s.api.HandleFunc("POST /api/worlds/{world_id}/invites/{invite_id}/revoke", s.handleRevokeWorldInvite)
	s.api.HandleFunc("GET /api/world-invites/{token}", s.handlePreviewWorldInvite)
	s.api.HandleFunc("POST /api/world-invites/{token}/redeem", s.handleRedeemWorldInvite)

	s.api.HandleFunc("GET /api/worlds/{world_id}/mechanics", s.handleListWorldMechanics)
	s.api.HandleFunc("POST /api/worlds/{world_id}/mechanics", s.handleCreateWorldMechanic)
	s.api.HandleFunc("GET /api/worlds/{world_id}/mechanics/{mechanic_id}", s.handleGetWorldMechanic)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/mechanics/{mechanic_id}", s.handlePutWorldMechanic)
	s.api.HandleFunc("POST /api/worlds/{world_id}/mechanics/{mechanic_id}/archive", s.handleArchiveWorldMechanic)

	s.api.HandleFunc("GET /api/worlds/{world_id}/entities", s.handleListWorldEntities)
	s.api.HandleFunc("POST /api/worlds/{world_id}/entities", s.handleCreateWorldEntity)
	s.api.HandleFunc("GET /api/worlds/{world_id}/entities/{entity_id}", s.handleGetWorldEntity)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/entities/{entity_id}", s.handlePutWorldEntity)
	s.api.HandleFunc("POST /api/worlds/{world_id}/entities/{entity_id}/archive", s.handleArchiveWorldEntity)
	s.api.HandleFunc("GET /api/worlds/{world_id}/entities/{entity_id}/state", s.handleGetWorldEntityState)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/entities/{entity_id}/state", s.handlePutWorldEntityState)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/entities/{entity_id}/controllers", s.handleReplaceWorldEntityControllers)
	s.api.HandleFunc("GET /api/worlds/{world_id}/entities/{entity_id}/profile", s.handleGetWorldEntityProfile)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/entities/{entity_id}/profile", s.handlePutWorldEntityProfile)

	s.api.HandleFunc("GET /api/worlds/{world_id}/character-fields", s.handleGetWorldCharacterFields)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/character-fields", s.handlePutWorldCharacterFields)

	s.api.HandleFunc("GET /api/worlds/{world_id}/interactions", s.handleListInteractions)
	s.api.HandleFunc("POST /api/worlds/{world_id}/interactions", s.handleCreateInteraction)
	s.api.HandleFunc("GET /api/worlds/{world_id}/interactions/{interaction_id}", s.handleGetInteraction)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/interactions/{interaction_id}", s.handlePutInteraction)
	s.api.HandleFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/present", s.handlePresentInteraction)
	s.api.HandleFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/adjudicate", s.handleBeginInteractionAdjudication)
	s.api.HandleFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/cancel", s.handleCancelInteraction)
	s.api.HandleFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/actions", s.handleCreateInteractionAction)
	s.api.HandleFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/actions/{action_id}/withdraw", s.handleWithdrawInteractionAction)
	s.api.HandleFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/preview", s.handlePreviewInteractionResolution)
	s.api.HandleFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/resolve", s.handleResolveInteraction)
	s.api.HandleFunc("GET /api/worlds/{world_id}/events", s.handleWorldEvents)
}
