package rules

func EntityImplementsAny(entity Entity, schemaIDs []ID) bool {
	if len(schemaIDs) == 0 {
		return false
	}
	have := idSet(entity.OwnerSchemaIDs)
	for _, id := range schemaIDs {
		if _, ok := have[id]; ok {
			return true
		}
	}
	return false
}

func EntityImplementsAll(entity Entity, schemaIDs []ID) bool {
	have := idSet(entity.OwnerSchemaIDs)
	for _, id := range schemaIDs {
		if _, ok := have[id]; !ok {
			return false
		}
	}
	return true
}

func schemaSetsIntersect(left, right []ID) bool {
	leftSet := idSet(left)
	for _, id := range right {
		if _, ok := leftSet[id]; ok {
			return true
		}
	}
	return false
}

func idSet(ids []ID) map[ID]struct{} {
	result := make(map[ID]struct{}, len(ids))
	for _, id := range ids {
		result[id] = struct{}{}
	}
	return result
}

func duplicateIDs(ids []ID) []ID {
	seen := make(map[ID]struct{}, len(ids))
	duplicates := make([]ID, 0)
	for _, id := range ids {
		if _, exists := seen[id]; exists {
			duplicates = append(duplicates, id)
		}
		seen[id] = struct{}{}
	}
	return duplicates
}
