import { useState } from "react";

import { api, ApiError, jsonBody, ruleSetPath } from "../api/client";
import type { OwnerSchema } from "../api/types";
import { ResourceWorkspace } from "../components/ResourceWorkspace";
import {
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

function newOwnerSchema(): OwnerSchema {
  return { id: "", key: "", label: "", description: "", archived: false };
}

export function OwnerSchemas({ ruleSetId }: { ruleSetId: string }) {
  const collection = useCollection<OwnerSchema>(
    ruleSetPath(ruleSetId, "owner-schemas"),
  );
  const [selected, setSelected] = useState<OwnerSchema | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Define / 01"
        title="Owner schemas"
        description="Create composable capabilities that make entities eligible to own configured state."
      />
      <ResourceWorkspace
        title="Schema library"
        items={collection.items}
        selectedId={selected?.id ?? null}
        getId={(item) => item.id}
        getTitle={(item) => item.label}
        getMeta={(item) => item.key}
        isArchived={(item) => item.archived}
        loading={collection.loading}
        error={collection.error}
        onRetry={collection.reload}
        onSelect={setSelected}
        onCreate={() => setSelected(newOwnerSchema())}
        createLabel="Schema"
        emptyTitle="No ownership vocabulary yet"
        emptyDescription="Create a capability such as anything your rules authors need. The engine gives its key no special meaning."
      >
        {selected === null ? (
          <EmptyState
            title="Choose a schema"
            description="Select an existing capability or create a new one to begin editing."
          />
        ) : (
          <OwnerSchemaEditor
            key={selected.id || "new"}
            source={selected}
            ruleSetId={ruleSetId}
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

function OwnerSchemaEditor({
  source,
  ruleSetId,
  onSaved,
}: {
  source: OwnerSchema;
  ruleSetId: string;
  onSaved: (schema: OwnerSchema) => void;
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
      const body = {
        ...(existing ? { id: draft.id } : {}),
        key: draft.key,
        label: draft.label,
        ...(draft.description?.trim() === ""
          ? {}
          : { description: draft.description }),
        archived: draft.archived,
      };
      const saved = await api<OwnerSchema>(
        existing
          ? ruleSetPath(ruleSetId, `owner-schemas/${draft.id}`)
          : ruleSetPath(ruleSetId, "owner-schemas"),
        {
          method: existing ? "PUT" : "POST",
          ...jsonBody(body),
        },
      );
      editor.accept(saved);
      onSaved(saved);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not save this schema."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="editor-stack">
      <Panel
        title={existing ? draft.label || "Untitled schema" : "New owner schema"}
        description="An entity may implement any number of independent capabilities."
        actions={
          <StatusBadge tone={draft.archived ? "neutral" : "good"}>
            {draft.archived ? "Archived" : "Active"}
          </StatusBadge>
        }
      >
        <div className="form-grid">
          <Field label="Label" required hint="The name authors see in pickers.">
            <input
              value={draft.label}
              onChange={(event) => {
                const label = event.currentTarget.value;
                editor.setDraft({
                  ...draft,
                  label,
                  key:
                    draft.key === slugify(draft.label)
                      ? slugify(label)
                      : draft.key,
                });
              }}
            />
          </Field>
          <Field
            label="Stable key"
            required
            hint="Keys are durable identity, never behavior."
          >
            <input
              value={draft.key}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              onChange={(event) =>
                editor.setDraft({ ...draft, key: event.currentTarget.value })
              }
            />
          </Field>
        </div>
        <Field
          label="Description"
          hint="Explain the capability without implying engine behavior."
        >
          <textarea
            value={draft.description ?? ""}
            onChange={(event) =>
              editor.setDraft({
                ...draft,
                description: event.currentTarget.value,
              })
            }
          />
        </Field>
      </Panel>
      <Panel
        title="Lifecycle"
        description="Archived schemas remain valid for existing uses but cannot be chosen for new configuration."
      >
        <ModeGroup
          legend="Schema status"
          value={draft.archived ? "archived" : "active"}
          options={[
            {
              value: "active",
              label: "Active",
              description: "Available in new memberships and definitions.",
            },
            {
              value: "archived",
              label: "Archived",
              description: "Retain existing references only.",
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
        noun="schema changes"
      />
    </div>
  );
}
