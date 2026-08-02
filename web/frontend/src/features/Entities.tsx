import { useState } from "react";

import { api, ApiError, jsonBody, ruleSetPath } from "../api/client";
import type { Entity, OwnerSchema } from "../api/types";
import { ResourceWorkspace } from "../components/ResourceWorkspace";
import {
  CheckPicker,
  EmptyState,
  Field,
  ModeGroup,
  PageHeader,
  Panel,
  SaveBar,
  StatusBadge,
} from "../components/ui";
import { slugify } from "../domain/options";
import { useCollection } from "../hooks/useCollection";
import { useDraft } from "../hooks/useDraft";

function newEntity(): Entity {
  return {
    id: "",
    display_name: "",
    key: "",
    owner_schema_ids: [],
    archived: false,
    state_revision: 0,
  };
}

export function Entities({ ruleSetId }: { ruleSetId: string }) {
  const collection = useCollection<Entity>(ruleSetPath(ruleSetId, "entities"));
  const schemas = useCollection<OwnerSchema>(
    ruleSetPath(ruleSetId, "owner-schemas"),
  );
  const [selected, setSelected] = useState<Entity | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="World / 01"
        title="Entities"
        description="Maintain durable identities that may own state, be referenced, or fill problem target slots."
      />
      <ResourceWorkspace
        title="Entity browser"
        items={collection.items}
        selectedId={selected?.id ?? null}
        getId={(item) => item.id}
        getTitle={(item) => item.display_name}
        getMeta={(item) => item.key ?? "No stable key"}
        isArchived={(item) => item.archived}
        loading={collection.loading}
        error={collection.error}
        onRetry={collection.reload}
        onSelect={setSelected}
        onCreate={() => setSelected(newEntity())}
        createLabel="Entity"
        emptyTitle="The world is empty"
        emptyDescription="Create a generic durable identity. It may remain schema-free when it only needs to be referenced."
      >
        {selected === null ? (
          <EmptyState
            title="Choose an entity"
            description="Select an entity to edit identity and ownership capabilities."
          />
        ) : (
          <EntityEditor
            key={selected.id || "new"}
            source={selected}
            ruleSetId={ruleSetId}
            schemas={schemas.items}
            onSaved={(saved) => {
              collection.replaceItem(saved, (item) => item.id);
              setSelected(saved);
            }}
          />
        )}
      </ResourceWorkspace>
    </>
  );
}

function EntityEditor({
  source,
  ruleSetId,
  schemas,
  onSaved,
}: {
  source: Entity;
  ruleSetId: string;
  schemas: OwnerSchema[];
  onSaved: (entity: Entity) => void;
}) {
  const editor = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const draft = editor.draft;
  const existing = draft.id !== "";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api<Entity>(
        existing
          ? ruleSetPath(ruleSetId, `entities/${draft.id}`)
          : ruleSetPath(ruleSetId, "entities"),
        {
          method: existing ? "PUT" : "POST",
          ...jsonBody({
            ...(existing ? { id: draft.id } : {}),
            display_name: draft.display_name,
            ...(draft.key?.trim() === "" ? {} : { key: draft.key }),
            owner_schema_ids: draft.owner_schema_ids,
            archived: draft.archived,
          }),
        },
      );
      editor.accept(saved);
      onSaved(saved);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not save this entity."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="editor-stack">
      <Panel
        title={
          existing ? draft.display_name || "Untitled entity" : "New entity"
        }
        description="Display identity is picker metadata, not a synchronized state variable."
        actions={
          existing ? (
            <StatusBadge tone="info">State r{draft.state_revision}</StatusBadge>
          ) : undefined
        }
      >
        <div className="form-grid">
          <Field label="Display name" required>
            <input
              value={draft.display_name}
              onChange={(event) => {
                const display_name = event.currentTarget.value;
                editor.setDraft({
                  ...draft,
                  display_name,
                  key:
                    draft.key === slugify(draft.display_name)
                      ? slugify(display_name)
                      : draft.key,
                });
              }}
            />
          </Field>
          <Field
            label="Stable key"
            hint="Optional. Useful for authored lookup; it grants no behavior."
          >
            <input
              value={draft.key ?? ""}
              onChange={(event) =>
                editor.setDraft({ ...draft, key: event.currentTarget.value })
              }
            />
          </Field>
        </div>
      </Panel>
      <Panel
        title="Ownership capabilities"
        description="An entity is eligible for a variable when it implements any schema allowed by that variable."
      >
        <CheckPicker
          legend="Implemented schemas"
          help="Zero schemas is valid: the entity may still be referenced or bound to an unconstrained target."
          options={schemas.map((schema) => ({
            id: schema.id,
            label: schema.label,
            description: schema.archived
              ? "Archived — retained selections only"
              : schema.key,
            disabled:
              schema.archived && !draft.owner_schema_ids.includes(schema.id),
          }))}
          selected={draft.owner_schema_ids}
          onChange={(owner_schema_ids) =>
            editor.setDraft({ ...draft, owner_schema_ids })
          }
          emptyLabel="Create an owner schema before assigning capabilities."
        />
        {existing &&
        source.owner_schema_ids.some(
          (id) => !draft.owner_schema_ids.includes(id),
        ) ? (
          <div className="notice notice-warn">
            <strong>Membership removal is semantic.</strong>
            <p>
              The server will reject this change if current state or active
              bindings would become ineligible. Your draft remains intact.
            </p>
          </div>
        ) : null}
      </Panel>
      <Panel title="Lifecycle">
        <ModeGroup
          legend="Entity status"
          value={draft.archived ? "archived" : "active"}
          options={[
            {
              value: "active",
              label: "Active",
              description: "Available in entity and binding pickers.",
            },
            {
              value: "archived",
              label: "Archived",
              description: "Retained for existing references.",
            },
          ]}
          onChange={(value) =>
            editor.setDraft({ ...draft, archived: value === "archived" })
          }
        />
      </Panel>
      <SaveBar
        dirty={editor.dirty}
        saving={saving}
        error={error}
        onReset={editor.reset}
        onSave={() => void save()}
        noun="entity changes"
      />
    </div>
  );
}
