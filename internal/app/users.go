package app

import (
	"net/http"
	"strings"
)

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		select id::text, display_name, created_at, updated_at
		from users order by lower(display_name), id limit 1000`)
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rows.Close()
	items := make([]userResponse, 0)
	for rows.Next() {
		var item userResponse
		if err := rows.Scan(&item.ID, &item.DisplayName, &item.CreatedAt, &item.UpdatedAt); err != nil {
			handleAppError(w, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var request createUserRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	validateRequired(fields, "display_name", request.DisplayName, 200)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "user is invalid", fields)
		return
	}
	var item userResponse
	err := s.db.QueryRow(r.Context(), `
		insert into users (id, display_name)
		values (coalesce(nullif($1, '')::uuid, gen_random_uuid()), $2)
		returning id::text, display_name, created_at, updated_at`,
		request.ID, strings.TrimSpace(request.DisplayName),
	).Scan(&item.ID, &item.DisplayName, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", "/api/users/"+item.ID)
	writeJSON(w, http.StatusCreated, item)
}
