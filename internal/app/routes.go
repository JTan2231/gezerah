package app

import "net/http"

func (s *Server) registerResourceRoutes() {
	s.handlePublicAPI("POST /api/auth/signup", s.withPublicMutation(http.HandlerFunc(s.handleSignup)))
	s.handlePublicAPI("POST /api/auth/signin", s.withPublicMutation(http.HandlerFunc(s.handleSignin)))
	s.authenticatedAPIFunc("GET /api/me", s.handleMe)
	s.authenticatedAPIFunc("PUT /api/me/password", s.handleChangePassword)
	s.authenticatedAPIFunc("POST /api/auth/logout", s.handleLogout)
	s.authenticatedAPIFunc("POST /api/auth/logout-all", s.handleLogoutAll)

	s.authenticatedAPIFunc("GET /api/worlds", s.handleListWorlds)
	s.authenticatedAPIFunc("POST /api/worlds", s.handleCreateWorld)
	s.authenticatedAPIFunc("GET /api/worlds/{world_id}", s.handleGetWorld)
	s.authenticatedAPIFunc("PATCH /api/worlds/{world_id}", s.handleUpdateWorld)
	s.authenticatedAPIFunc("PUT /api/worlds/{world_id}/facilitator", s.handleUpdateFacilitator)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/archive", s.handleArchiveWorld)
	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/members", s.handleListWorldMembers)

	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/invites", s.handleListWorldInvites)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/invites", s.handleCreateWorldInvite)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/invites/{invite_id}/revoke", s.handleRevokeWorldInvite)
	s.authenticatedAPIFunc("GET /api/world-invites/{token}", s.handlePreviewWorldInvite)
	s.authenticatedAPIFunc("POST /api/world-invites/{token}/redeem", s.handleRedeemWorldInvite)

	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/mechanics", s.handleListWorldMechanics)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/mechanics", s.handleCreateWorldMechanic)
	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/mechanics/{mechanic_id}", s.handleGetWorldMechanic)
	s.authenticatedAPIFunc("PUT /api/worlds/{world_id}/mechanics/{mechanic_id}", s.handlePutWorldMechanic)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/mechanics/{mechanic_id}/archive", s.handleArchiveWorldMechanic)

	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/entities", s.handleListWorldEntities)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/entities", s.handleCreateWorldEntity)
	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/entities/{entity_id}", s.handleGetWorldEntity)
	s.authenticatedAPIFunc("PUT /api/worlds/{world_id}/entities/{entity_id}", s.handlePutWorldEntity)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/entities/{entity_id}/archive", s.handleArchiveWorldEntity)
	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/entities/{entity_id}/state", s.handleGetWorldEntityState)
	s.authenticatedAPIFunc("PUT /api/worlds/{world_id}/entities/{entity_id}/state", s.handlePutWorldEntityState)
	s.authenticatedAPIFunc("PUT /api/worlds/{world_id}/entities/{entity_id}/controllers", s.handleReplaceWorldEntityControllers)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/entities/{entity_id}/claim", s.handleClaimWorldEntity)
	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/entities/{entity_id}/profile", s.handleGetWorldEntityProfile)
	s.authenticatedAPIFunc("PUT /api/worlds/{world_id}/entities/{entity_id}/profile", s.handlePutWorldEntityProfile)
	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/available-characters", s.handleListAvailableAgentCharacters)

	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/character-fields", s.handleGetWorldCharacterFields)
	s.authenticatedAPIFunc("PUT /api/worlds/{world_id}/character-fields", s.handlePutWorldCharacterFields)

	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/interactions", s.handleListInteractions)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions", s.handleCreateInteraction)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/auto-dm/continue", s.handleContinueAutoDM)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/agent-dm/continue", s.handleContinueAgentDM)
	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/interactions/{interaction_id}", s.handleGetInteraction)
	s.authenticatedAPIFunc("PUT /api/worlds/{world_id}/interactions/{interaction_id}", s.handlePutInteraction)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/present", s.handlePresentInteraction)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/adjudicate", s.handleBeginInteractionAdjudication)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/cancel", s.handleCancelInteraction)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/actions", s.handleCreateInteractionAction)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/actions/{action_id}/withdraw", s.handleWithdrawInteractionAction)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/preview", s.handlePreviewInteractionResolution)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/resolve", s.handleResolveInteraction)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/auto-dm/decide", s.handleDecideAutoDMInteraction)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/agent-dm/resolve", s.handleResolveAgentDMInteraction)
	s.authenticatedAPIFunc("POST /api/worlds/{world_id}/interactions/{interaction_id}/compile-consequence", s.handleCompileConsequence)
	s.authenticatedAPIFunc("GET /api/worlds/{world_id}/events", s.handleWorldEvents)
}

func (s *Server) authenticatedAPIFunc(pattern string, handler http.HandlerFunc) {
	s.HandleAPIFunc(pattern, handler)
}
