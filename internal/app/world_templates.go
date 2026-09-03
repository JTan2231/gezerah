package app

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"github.com/JTan2231/wrought/internal/rules"
	"github.com/jackc/pgx/v5"
	"gopkg.in/yaml.v3"
)

const (
	worldTemplateDirectory = "world_templates"
	worldTemplateCount     = 3
)

var templateAliasPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)

//go:embed world_templates/*.md
var embeddedWorldTemplateFiles embed.FS

var embeddedWorldTemplateCatalog = mustLoadWorldTemplateCatalog(embeddedWorldTemplateFiles)

type worldTemplateCatalog struct {
	items []worldTemplate
	byID  map[string]worldTemplate
}

type worldTemplate struct {
	ID               string                        `yaml:"id"`
	Version          int                           `yaml:"version"`
	Name             string                        `yaml:"name"`
	Summary          string                        `yaml:"summary"`
	Setting          string                        `yaml:"setting"`
	WorldDescription string                        `yaml:"world_description"`
	ProseGuide       string                        `yaml:"prose_guide"`
	Mechanics        []worldTemplateMechanic       `yaml:"mechanics"`
	CharacterFields  []worldTemplateCharacterField `yaml:"character_fields"`
	Entities         []worldTemplateEntity         `yaml:"entities"`
}

type worldTemplateMechanic struct {
	Key               string                   `yaml:"key"`
	Kind              string                   `yaml:"kind"`
	Mode              string                   `yaml:"mode"`
	SourceKind        string                   `yaml:"source_kind"`
	Name              string                   `yaml:"name"`
	Description       *string                  `yaml:"description,omitempty"`
	Minimum           *decimalText             `yaml:"minimum,omitempty"`
	Maximum           *decimalText             `yaml:"maximum,omitempty"`
	Step              *decimalText             `yaml:"step,omitempty"`
	DefaultNumber     *decimalText             `yaml:"default_number,omitempty"`
	Unit              *string                  `yaml:"unit,omitempty"`
	MutableDuringPlay bool                     `yaml:"mutable_during_play"`
	Expression        *worldTemplateExpression `yaml:"expression,omitempty"`
}

type worldTemplateExpression struct {
	Operation string                    `yaml:"operation"`
	Mechanic  string                    `yaml:"mechanic,omitempty"`
	Value     *worldTemplateValue       `yaml:"value,omitempty"`
	Operands  []worldTemplateExpression `yaml:"operands,omitempty"`
}

type worldTemplateValue struct {
	Kind    string       `yaml:"kind"`
	Number  *decimalText `yaml:"number,omitempty"`
	Boolean *bool        `yaml:"boolean,omitempty"`
}

type worldTemplateCharacterField struct {
	Key        string  `yaml:"key"`
	Label      string  `yaml:"label"`
	HelpText   *string `yaml:"help_text,omitempty"`
	Visibility string  `yaml:"visibility"`
}

type worldTemplateEntity struct {
	Key                string                        `yaml:"key"`
	DisplayName        string                        `yaml:"display_name"`
	Profile            map[string]string             `yaml:"profile"`
	LogicalInputValues map[string]worldTemplateValue `yaml:"logical_input_values,omitempty"`
}

func mustLoadWorldTemplateCatalog(files fs.FS) worldTemplateCatalog {
	catalog, err := loadWorldTemplateCatalog(files)
	if err != nil {
		panic(fmt.Sprintf("load embedded World templates: %v", err))
	}
	return catalog
}

func loadWorldTemplateCatalog(files fs.FS) (worldTemplateCatalog, error) {
	paths, err := fs.Glob(files, worldTemplateDirectory+"/*.md")
	if err != nil {
		return worldTemplateCatalog{}, err
	}
	sort.Strings(paths)
	if len(paths) != worldTemplateCount {
		return worldTemplateCatalog{}, fmt.Errorf("found %d Markdown templates, want exactly %d", len(paths), worldTemplateCount)
	}

	catalog := worldTemplateCatalog{
		items: make([]worldTemplate, 0, len(paths)),
		byID:  make(map[string]worldTemplate, len(paths)),
	}
	for _, path := range paths {
		template, err := loadWorldTemplate(files, path)
		if err != nil {
			return worldTemplateCatalog{}, fmt.Errorf("%s: %w", path, err)
		}
		if _, duplicate := catalog.byID[template.ID]; duplicate {
			return worldTemplateCatalog{}, fmt.Errorf("duplicate template id %q", template.ID)
		}
		catalog.items = append(catalog.items, template)
		catalog.byID[template.ID] = template
	}
	return catalog, nil
}

func loadWorldTemplate(files fs.FS, path string) (worldTemplate, error) {
	contents, err := fs.ReadFile(files, path)
	if err != nil {
		return worldTemplate{}, err
	}
	manifest, narrative, err := splitWorldTemplateMarkdown(string(contents))
	if err != nil {
		return worldTemplate{}, err
	}
	if !strings.HasPrefix(strings.TrimSpace(narrative), "# ") || len([]rune(strings.TrimSpace(narrative))) < 200 {
		return worldTemplate{}, errors.New("narrative Markdown must begin with a title and fully explain the template")
	}

	var result worldTemplate
	decoder := yaml.NewDecoder(strings.NewReader(manifest))
	decoder.KnownFields(true)
	if err := decoder.Decode(&result); err != nil {
		return worldTemplate{}, fmt.Errorf("decode YAML front matter: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return worldTemplate{}, errors.New("YAML front matter must contain one document")
		}
		return worldTemplate{}, fmt.Errorf("decode YAML front matter: %w", err)
	}
	if err := validateWorldTemplate(&result); err != nil {
		return worldTemplate{}, err
	}
	return result, nil
}

func splitWorldTemplateMarkdown(contents string) (string, string, error) {
	normalized := strings.ReplaceAll(contents, "\r\n", "\n")
	if !strings.HasPrefix(normalized, "---\n") {
		return "", "", errors.New("markdown template must begin with YAML front matter")
	}
	boundary := strings.Index(normalized[4:], "\n---\n")
	if boundary < 0 {
		return "", "", errors.New("YAML front matter is not closed")
	}
	boundary += 4
	return normalized[4:boundary], normalized[boundary+5:], nil
}

func validateWorldTemplate(template *worldTemplate) error {
	template.ID = strings.TrimSpace(template.ID)
	template.Name = strings.TrimSpace(template.Name)
	template.Summary = strings.TrimSpace(template.Summary)
	template.Setting = strings.TrimSpace(template.Setting)
	template.WorldDescription = strings.TrimSpace(template.WorldDescription)
	template.ProseGuide = strings.TrimSpace(template.ProseGuide)
	if !templateAliasPattern.MatchString(template.ID) {
		return errors.New("id must be a lowercase file-local slug")
	}
	for path, value := range map[string]string{
		"name": template.Name, "summary": template.Summary,
		"setting": template.Setting, "world_description": template.WorldDescription,
		"prose_guide": template.ProseGuide,
	} {
		if value == "" {
			return fmt.Errorf("%s is required", path)
		}
	}
	if template.Version < 1 {
		return errors.New("version must be a positive integer")
	}
	if len([]rune(template.Name)) > 200 ||
		len([]rune(template.Summary)) > 1000 || len([]rune(template.Setting)) > 200 ||
		len([]rune(template.WorldDescription)) > 20000 ||
		len([]rune(template.ProseGuide)) > maxWorldProseGuideLength {
		return errors.New("template metadata exceeds its supported length")
	}
	if len(template.Mechanics) == 0 || len(template.Mechanics) > 100 {
		return errors.New("mechanics must contain between 1 and 100 definitions")
	}
	if len(template.CharacterFields) == 0 || len(template.CharacterFields) > maxWorldCharacterFields {
		return fmt.Errorf("character_fields must contain between 1 and %d definitions", maxWorldCharacterFields)
	}
	if len(template.Entities) == 0 || len(template.Entities) > 50 {
		return errors.New("entities must contain between 1 and 50 definitions")
	}

	mechanicIDs := make(map[string]string, len(template.Mechanics))
	for index := range template.Mechanics {
		mechanic := &template.Mechanics[index]
		mechanic.Key = strings.TrimSpace(mechanic.Key)
		if !templateAliasPattern.MatchString(mechanic.Key) {
			return fmt.Errorf("mechanics[%d].key must be a lowercase file-local alias", index)
		}
		if _, duplicate := mechanicIDs[mechanic.Key]; duplicate {
			return fmt.Errorf("mechanics[%d].key duplicates %q", index, mechanic.Key)
		}
		mechanicIDs[mechanic.Key] = placeholderTemplateID(index + 1)
	}
	definitions := make(map[rules.ID]rules.MechanicDefinition, len(template.Mechanics))
	for index := range template.Mechanics {
		request, err := template.Mechanics[index].saveRequest(mechanicIDs)
		if err != nil {
			return fmt.Errorf("mechanics[%d]: %w", index, err)
		}
		definitionID := mechanicIDs[template.Mechanics[index].Key]
		fields, definition := validateWorldMechanicRequest(placeholderTemplateID(0), definitionID, request)
		if len(fields) > 0 {
			return fmt.Errorf("mechanics[%d] is invalid: %s", index, formatTemplateFields(fields))
		}
		definitions[definition.ID] = definition
	}
	if err := validateWorldMechanicGraph(definitions); err != nil {
		return fmt.Errorf("mechanic graph is invalid: %w", err)
	}

	fieldIDs := make(map[string]string, len(template.CharacterFields))
	fieldRequest := replaceWorldCharacterFieldsRequest{ExpectedRevision: templateInt64Pointer(0)}
	for index := range template.CharacterFields {
		field := &template.CharacterFields[index]
		field.Key = strings.TrimSpace(field.Key)
		if !templateAliasPattern.MatchString(field.Key) {
			return fmt.Errorf("character_fields[%d].key must be a lowercase file-local alias", index)
		}
		if _, duplicate := fieldIDs[field.Key]; duplicate {
			return fmt.Errorf("character_fields[%d].key duplicates %q", index, field.Key)
		}
		fieldIDs[field.Key] = placeholderTemplateID(1000 + index)
		fieldRequest.Fields = append(fieldRequest.Fields, saveWorldCharacterFieldRequest{
			ID: fieldIDs[field.Key], Label: field.Label, HelpText: field.HelpText, Visibility: field.Visibility,
		})
	}
	if fields := validateWorldCharacterFieldsRequest(&fieldRequest); len(fields) > 0 {
		return fmt.Errorf("character_fields are invalid: %s", formatTemplateFields(fields))
	}
	for index := range template.CharacterFields {
		template.CharacterFields[index].Label = fieldRequest.Fields[index].Label
		template.CharacterFields[index].HelpText = fieldRequest.Fields[index].HelpText
		template.CharacterFields[index].Visibility = fieldRequest.Fields[index].Visibility
	}

	entityKeys := make(map[string]struct{}, len(template.Entities))
	entityNames := make(map[string]struct{}, len(template.Entities))
	for index := range template.Entities {
		entity := &template.Entities[index]
		entity.Key = strings.TrimSpace(entity.Key)
		entity.DisplayName = strings.TrimSpace(entity.DisplayName)
		if !templateAliasPattern.MatchString(entity.Key) {
			return fmt.Errorf("entities[%d].key must be a lowercase file-local alias", index)
		}
		if _, duplicate := entityKeys[entity.Key]; duplicate {
			return fmt.Errorf("entities[%d].key duplicates %q", index, entity.Key)
		}
		entityKeys[entity.Key] = struct{}{}
		if entity.DisplayName == "" || len([]rune(entity.DisplayName)) > 200 {
			return fmt.Errorf("entities[%d].display_name is invalid", index)
		}
		normalizedName := strings.ToLower(entity.DisplayName)
		if _, duplicate := entityNames[normalizedName]; duplicate {
			return fmt.Errorf("entities[%d].display_name duplicates %q", index, entity.DisplayName)
		}
		entityNames[normalizedName] = struct{}{}
		if len(entity.Profile) != len(fieldIDs) {
			return fmt.Errorf("entities[%d].profile must complete every character field", index)
		}
		for fieldKey := range fieldIDs {
			value, exists := entity.Profile[fieldKey]
			value = strings.TrimSpace(value)
			if !exists || value == "" || len([]rune(value)) > 20000 {
				return fmt.Errorf("entities[%d].profile[%s] must be non-empty and at most 20000 characters", index, fieldKey)
			}
			entity.Profile[fieldKey] = value
		}
		for fieldKey := range entity.Profile {
			if _, exists := fieldIDs[fieldKey]; !exists {
				return fmt.Errorf("entities[%d].profile references unknown field alias %q", index, fieldKey)
			}
		}

		domainEntity := rules.Entity{
			ID: rules.ID(placeholderTemplateID(2000 + index)), WorldID: rules.ID(placeholderTemplateID(0)),
			DisplayName: entity.DisplayName,
		}
		overrides := make(map[rules.ID]rules.MechanicValue, len(entity.LogicalInputValues))
		for mechanicKey, value := range entity.LogicalInputValues {
			mechanicID, exists := mechanicIDs[mechanicKey]
			if !exists {
				return fmt.Errorf("entities[%d].logical_input_values references unknown mechanic alias %q", index, mechanicKey)
			}
			converted, err := value.domain()
			if err != nil {
				return fmt.Errorf("entities[%d].logical_input_values[%s]: %w", index, mechanicKey, err)
			}
			overrides[rules.ID(mechanicID)] = converted
		}
		record := rules.NormalizeInputOverrideRecord(rules.InputOverrideRecord{
			EntityID: domainEntity.ID, Overrides: overrides,
		}, definitions)
		for mechanicKey := range entity.LogicalInputValues {
			if _, retained := record.Overrides[rules.ID(mechanicIDs[mechanicKey])]; !retained {
				delete(entity.LogicalInputValues, mechanicKey)
			}
		}
		for _, item := range rules.ValidateInputOverrideRecord(record, domainEntity, definitions) {
			return fmt.Errorf("entities[%d].logical_input_values.%s: %s", index, item.Path, item.Message)
		}
	}
	return nil
}

func (mechanic worldTemplateMechanic) saveRequest(mechanicIDs map[string]string) (saveWorldMechanicRequest, error) {
	request := saveWorldMechanicRequest{
		Kind: mechanic.Kind, Mode: mechanic.Mode, SourceKind: mechanic.SourceKind,
		Name: strings.TrimSpace(mechanic.Name), Description: cleanOptional(mechanic.Description),
		Minimum: mechanic.Minimum, Maximum: mechanic.Maximum, Step: mechanic.Step,
		DefaultNumber: mechanic.DefaultNumber, Unit: cleanOptional(mechanic.Unit),
		MutableDuringPlay: mechanic.MutableDuringPlay,
	}
	if mechanic.Expression != nil {
		expression, err := mechanic.Expression.dto(mechanicIDs)
		if err != nil {
			return saveWorldMechanicRequest{}, err
		}
		request.Expression = &expression
	}
	return request, nil
}

func (expression worldTemplateExpression) dto(mechanicIDs map[string]string) (expressionDTO, error) {
	result := expressionDTO{Operation: strings.TrimSpace(expression.Operation)}
	if expression.Mechanic != "" {
		mechanicID, exists := mechanicIDs[strings.TrimSpace(expression.Mechanic)]
		if !exists {
			return expressionDTO{}, fmt.Errorf("expression references unknown mechanic alias %q", expression.Mechanic)
		}
		result.MechanicID = mechanicID
	}
	if expression.Value != nil {
		value, err := expression.Value.dto()
		if err != nil {
			return expressionDTO{}, err
		}
		result.Value = &value
	}
	result.Operands = make([]expressionDTO, len(expression.Operands))
	for index, operand := range expression.Operands {
		converted, err := operand.dto(mechanicIDs)
		if err != nil {
			return expressionDTO{}, fmt.Errorf("operand %d: %w", index, err)
		}
		result.Operands[index] = converted
	}
	return result, nil
}

func (value worldTemplateValue) dto() (mechanicValueDTO, error) {
	domain, err := value.domain()
	if err != nil {
		return mechanicValueDTO{}, err
	}
	return mechanicValueDomainToDTO(domain), nil
}

func (value worldTemplateValue) domain() (rules.MechanicValue, error) {
	switch strings.TrimSpace(value.Kind) {
	case "number":
		if value.Number == nil || value.Boolean != nil {
			return rules.MechanicValue{}, errors.New("number value requires only number")
		}
		parsed, err := value.Number.Decimal()
		if err != nil {
			return rules.MechanicValue{}, errors.New("number must be a finite exact decimal")
		}
		return rules.NewNumberMechanicValue(parsed), nil
	case "boolean":
		if value.Boolean == nil || value.Number != nil {
			return rules.MechanicValue{}, errors.New("boolean value requires only boolean")
		}
		return rules.NewBooleanMechanicValue(*value.Boolean), nil
	default:
		return rules.MechanicValue{}, errors.New("value kind must be number or boolean")
	}
}

func placeholderTemplateID(index int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012x", index+1)
}

func templateInt64Pointer(value int64) *int64 { return &value }

func formatTemplateFields(fields map[string]string) string {
	paths := make([]string, 0, len(fields))
	for path := range fields {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	parts := make([]string, len(paths))
	for index, path := range paths {
		parts[index] = path + ": " + fields[path]
	}
	return strings.Join(parts, "; ")
}

func (s *Server) handleListWorldTemplates(w http.ResponseWriter, r *http.Request) {
	if _, err := requireKnownActor(r.Context(), s.db, r); err != nil {
		handleAppError(w, err)
		return
	}
	items := make([]worldTemplateResponse, len(s.worldTemplates.items))
	for index, template := range s.worldTemplates.items {
		items[index] = worldTemplateResponse{
			ID: template.ID, Name: template.Name, Description: template.Summary,
			Setting: template.Setting, ProseGuide: template.ProseGuide,
			CharacterCount: len(template.Entities), Version: template.Version,
		}
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCloneWorldTemplate(w http.ResponseWriter, r *http.Request) {
	userID, err := requireKnownActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	template, exists := s.worldTemplates.byID[r.PathValue("template_id")]
	if !exists {
		handleAppError(w, &statusError{Status: http.StatusNotFound, Code: "world_template_not_found", Message: "World template is unavailable"})
		return
	}
	var request cloneWorldTemplateRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.ID = strings.TrimSpace(request.ID)
	if !validID(request.ID) {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "template copy is invalid", map[string]string{"id": "a destination World UUID is required"})
		return
	}

	created, err := s.cloneWorldTemplate(r.Context(), userID, request.ID, template)
	if err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, request.ID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
		w.Header().Set("Location", publicProductPath("/api/worlds/"+request.ID))
	}
	writeJSON(w, status, item)
}

func (s *Server) cloneWorldTemplate(ctx context.Context, userID, worldID string, template worldTemplate) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer rollbackTx(ctx, tx)

	// The actor row is the idempotency serialization root. A retry with the same
	// client-generated destination UUID observes either no World or the complete
	// committed World; it can never observe a partial copy.
	var lockedUserID string
	if err := tx.QueryRow(ctx, `select id::text from users where id = $1 for update`, userID).Scan(&lockedUserID); err != nil {
		return false, err
	}
	var createdByUserID, existingName, existingFacilitatorSource string
	var existingDescription, existingProseGuide *string
	err = tx.QueryRow(ctx, `
		select created_by_user_id::text, name, description, prose_guide, facilitator_source
		from worlds where id = $1`, worldID,
	).Scan(
		&createdByUserID, &existingName, &existingDescription, &existingProseGuide,
		&existingFacilitatorSource,
	)
	if err == nil {
		if createdByUserID != userID || existingName != template.Name || existingDescription == nil ||
			*existingDescription != template.WorldDescription || existingProseGuide == nil ||
			*existingProseGuide != template.ProseGuide || existingFacilitatorSource != "agent" {
			return false, &statusError{Status: http.StatusConflict, Code: "idempotency_conflict", Message: "destination World ID is already in use"}
		}
		var ownsWorld bool
		if err := tx.QueryRow(ctx, `
			select exists(
				select 1 from world_memberships
				where world_id = $1 and user_id = $2 and role = 'owner' and status = 'active'
			)`, worldID, userID).Scan(&ownsWorld); err != nil {
			return false, err
		}
		if !ownsWorld {
			return false, &statusError{Status: http.StatusConflict, Code: "idempotency_conflict", Message: "destination World ID is already in use"}
		}
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		return false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}

	membershipID, err := newID()
	if err != nil {
		return false, err
	}
	mechanicIDs, err := freshTemplateIDs(template.Mechanics, func(item worldTemplateMechanic) string { return item.Key })
	if err != nil {
		return false, err
	}
	fieldIDs, err := freshTemplateIDs(template.CharacterFields, func(item worldTemplateCharacterField) string { return item.Key })
	if err != nil {
		return false, err
	}
	entityIDs, err := freshTemplateIDs(template.Entities, func(item worldTemplateEntity) string { return item.Key })
	if err != nil {
		return false, err
	}

	if _, err := tx.Exec(ctx, `
		insert into worlds (
			id, name, description, prose_guide, created_by_user_id,
			facilitator_source, facilitator_membership_id
		) values ($1, $2, $3, $4, $5, 'agent', null)`,
		worldID, template.Name, template.WorldDescription, template.ProseGuide, userID); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `
		insert into world_memberships (id, world_id, user_id, role, status, joined_at)
		values ($1, $2, $3, 'owner', 'active', now())`, membershipID, worldID, userID); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `insert into world_character_field_sets (world_id) values ($1)`, worldID); err != nil {
		return false, err
	}

	definitions := make(map[rules.ID]rules.MechanicDefinition, len(template.Mechanics))
	positions := map[string]int{"capacity": 0, "capability": 0}
	for _, mechanic := range template.Mechanics {
		request, err := mechanic.saveRequest(mechanicIDs)
		if err != nil {
			return false, err
		}
		_, definition := validateWorldMechanicRequest(worldID, mechanicIDs[mechanic.Key], request)
		definitions[definition.ID] = definition
		position := positions[mechanic.Kind]
		if err := insertWorldMechanic(ctx, tx, request, definition, position); err != nil {
			return false, err
		}
		positions[mechanic.Kind] = position + 1
	}
	for _, mechanic := range template.Mechanics {
		definition := definitions[rules.ID(mechanicIDs[mechanic.Key])]
		if definition.SourceKind == rules.SourceDerived {
			if err := insertMechanicExpression(ctx, tx, definition, definitions); err != nil {
				return false, err
			}
		}
	}

	for position, field := range template.CharacterFields {
		if _, err := tx.Exec(ctx, `
			insert into world_character_fields (
				id, world_id, label, help_text, visibility, position,
				created_by_user_id, updated_by_user_id
			) values ($1, $2, $3, $4, $5, $6, $7, $7)`,
			fieldIDs[field.Key], worldID, field.Label, field.HelpText, field.Visibility, position, userID); err != nil {
			return false, err
		}
	}

	for _, entity := range template.Entities {
		entityID := entityIDs[entity.Key]
		if _, err := tx.Exec(ctx, `insert into entities (id, world_id, display_name) values ($1, $2, $3)`, entityID, worldID, entity.DisplayName); err != nil {
			return false, err
		}
		if _, err := tx.Exec(ctx, `insert into entity_logical_states (entity_id, world_id) values ($1, $2)`, entityID, worldID); err != nil {
			return false, err
		}
		if _, err := tx.Exec(ctx, `
			insert into entity_profiles (entity_id, world_id, created_by_user_id, updated_by_user_id)
			values ($1, $2, $3, $3)`, entityID, worldID, userID); err != nil {
			return false, err
		}
		for _, field := range template.CharacterFields {
			if _, err := tx.Exec(ctx, `
				insert into entity_profile_values (
					entity_id, field_id, world_id, body, created_by_user_id, updated_by_user_id
				) values ($1, $2, $3, $4, $5, $5)`,
				entityID, fieldIDs[field.Key], worldID, entity.Profile[field.Key], userID); err != nil {
				return false, err
			}
		}
		mechanicKeys := make([]string, 0, len(entity.LogicalInputValues))
		for mechanicKey := range entity.LogicalInputValues {
			mechanicKeys = append(mechanicKeys, mechanicKey)
		}
		sort.Strings(mechanicKeys)
		for _, mechanicKey := range mechanicKeys {
			value, err := entity.LogicalInputValues[mechanicKey].domain()
			if err != nil {
				return false, err
			}
			if err := insertInputValueOverride(ctx, tx, worldID, entityID, rules.ID(mechanicIDs[mechanicKey]), value); err != nil {
				return false, err
			}
		}
	}
	if err := appendWorldEvent(ctx, tx, worldID, "world-created", membershipID, nil, nil, nil); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func freshTemplateIDs[T any](items []T, key func(T) string) (map[string]string, error) {
	result := make(map[string]string, len(items))
	for _, item := range items {
		id, err := newID()
		if err != nil {
			return nil, err
		}
		result[key(item)] = id
	}
	return result, nil
}
