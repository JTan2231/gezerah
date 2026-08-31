package app

import (
	"errors"
	"net/http"
	"testing"

	"scryer/internal/rules"
)

func TestConsequenceTargetEligibilityRejectsIncompleteCharactersAtRuntimePaths(t *testing.T) {
	t.Parallel()
	plan := rules.TransitionPlan{Effects: []rules.ConcreteEffect{
		{ID: "first", Position: 0, EntityIDs: []rules.ID{"ready", "incomplete"}},
		{ID: "second", Position: 1, EntityIDs: []rules.ID{"incomplete"}},
	}}

	err := consequenceTargetEligibilityError(plan, map[rules.ID]string{
		"ready":      "ready",
		"incomplete": "setup-required",
	})
	var status *statusError
	if !errors.As(err, &status) {
		t.Fatalf("error = %#v, want statusError", err)
	}
	if status.Status != http.StatusUnprocessableEntity || status.Code != "transition_failed" {
		t.Fatalf("status error = %#v", status)
	}
	const message = "controlled character setup must be complete"
	if status.Message != "invalid transition: effects[0].entity_ids[1]: "+message+"; effects[1].entity_ids[0]: "+message {
		t.Fatalf("message = %q", status.Message)
	}
	for _, path := range []string{"effects[0].entity_ids[1]", "effects[1].entity_ids[0]"} {
		if status.Fields[path] != message {
			t.Errorf("field %s = %q", path, status.Fields[path])
		}
	}
}

func TestConsequenceTargetEligibilityAllowsReadyAndNonCharacterTargets(t *testing.T) {
	t.Parallel()
	plan := rules.TransitionPlan{Effects: []rules.ConcreteEffect{{
		ID: "effect", Position: 0, EntityIDs: []rules.ID{"ready", "npc", "unknown"},
	}}}

	if err := consequenceTargetEligibilityError(plan, map[rules.ID]string{
		"ready": "ready",
		"npc":   "not-controlled",
	}); err != nil {
		t.Fatalf("error = %v", err)
	}
}
