package app

import (
	"strings"
	"testing"
	"testing/fstest"
)

func TestEmbeddedWorldTemplateCatalogIsCompleteAndValidated(t *testing.T) {
	if len(embeddedWorldTemplateCatalog.items) != worldTemplateCount {
		t.Fatalf("template count = %d, want %d", len(embeddedWorldTemplateCatalog.items), worldTemplateCount)
	}
	want := map[string]string{
		"banners-at-eldermead": "Banners at Eldermead",
		"the-courtesy-season":  "The Courtesy Season",
		"terms-of-the-city":    "Terms of the City",
	}
	for _, template := range embeddedWorldTemplateCatalog.items {
		if wantName, exists := want[template.ID]; !exists || template.Name != wantName {
			t.Errorf("unexpected catalog item %q (%q)", template.ID, template.Name)
		}
		if template.Version < 1 || len(template.Entities) != 5 {
			t.Errorf("template %q version/entities = %d/%d, want positive/5", template.ID, template.Version, len(template.Entities))
		}
		for _, mechanic := range template.Mechanics {
			if validID(mechanic.Key) {
				t.Errorf("template %q mechanic key %q is a durable UUID, want a file-local alias", template.ID, mechanic.Key)
			}
		}
	}
}

func TestLoadWorldTemplateUsesStrictYAMLAndNarrativeMarkdown(t *testing.T) {
	t.Parallel()
	files := fstest.MapFS{
		"world_templates/example.md": &fstest.MapFile{Data: []byte(validWorldTemplateMarkdown("example"))},
	}
	template, err := loadWorldTemplate(files, "world_templates/example.md")
	if err != nil {
		t.Fatalf("loadWorldTemplate() error = %v", err)
	}
	if template.ID != "example" || template.CharacterFields[0].Visibility != "world" {
		t.Fatalf("loaded template = %#v", template)
	}

	unknown := strings.Replace(validWorldTemplateMarkdown("example"), "version: 1", "version: 1\nunknown_key: rejected", 1)
	files["world_templates/unknown.md"] = &fstest.MapFile{Data: []byte(unknown)}
	if _, err := loadWorldTemplate(files, "world_templates/unknown.md"); err == nil || !strings.Contains(err.Error(), "field unknown_key not found") {
		t.Fatalf("unknown YAML field error = %v", err)
	}
}

func TestLoadWorldTemplateRejectsUnknownAliasesAndIncompleteProfiles(t *testing.T) {
	t.Parallel()
	unknownMechanic := strings.Replace(
		validWorldTemplateMarkdown("unknown-reference"),
		"    profile:",
		"    logical_input_values:\n      missing-mechanic:\n        kind: number\n        number: \"2\"\n    profile:",
		1,
	)
	files := fstest.MapFS{
		"world_templates/unknown-reference.md": &fstest.MapFile{Data: []byte(unknownMechanic)},
	}
	if _, err := loadWorldTemplate(files, "world_templates/unknown-reference.md"); err == nil || !strings.Contains(err.Error(), "unknown mechanic alias") {
		t.Fatalf("unknown alias error = %v", err)
	}

	incomplete := strings.Replace(validWorldTemplateMarkdown("incomplete"), "      identity: An ordinary person with obligations.", "", 1)
	files["world_templates/incomplete.md"] = &fstest.MapFile{Data: []byte(incomplete)}
	if _, err := loadWorldTemplate(files, "world_templates/incomplete.md"); err == nil || !strings.Contains(err.Error(), "profile must complete every character field") {
		t.Fatalf("incomplete profile error = %v", err)
	}
}

func TestSplitWorldTemplateMarkdownAcceptsCRLF(t *testing.T) {
	t.Parallel()
	manifest, narrative, err := splitWorldTemplateMarkdown(strings.ReplaceAll(validWorldTemplateMarkdown("crlf"), "\n", "\r\n"))
	if err != nil {
		t.Fatalf("splitWorldTemplateMarkdown() error = %v", err)
	}
	if !strings.Contains(manifest, "id: crlf") || !strings.HasPrefix(narrative, "# Example") {
		t.Fatalf("manifest/narrative split incorrectly: %q / %q", manifest, narrative)
	}
}

func validWorldTemplateMarkdown(id string) string {
	return `---
id: ` + id + `
version: 1
name: Example World
summary: A concise selection-card summary.
setting: Example setting
world_description: >-
  A complete World description that gives the Facilitator enough concrete material to begin play without a reusable Problem.
mechanics:
  - key: resolve
    kind: capacity
    mode: pool
    source_kind: input
    name: Resolve
    minimum: "0"
    maximum: "5"
    step: "1"
    default_number: "3"
    mutable_during_play: true
character_fields:
  - key: identity
    label: Identity
    help_text: The reputation and obligations that precede this Character.
    visibility: world
entities:
  - key: example-character
    display_name: Example Character
    profile:
      identity: An ordinary person with obligations.
---
# Example World

This readable narrative explains the premise, the expected tone, and the pressure surrounding the available Character. It exists alongside the complete YAML front matter so a reviewer can understand and revise the template without reading application code.

## Opening pressure

The Facilitator should establish a materially changed place, introduce an immediate conflict, and let the player choose freely. The opening remains improvised during Play rather than becoming a stored Problem or encounter sequence.
`
}
