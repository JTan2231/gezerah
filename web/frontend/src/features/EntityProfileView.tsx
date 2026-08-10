import type { ReactNode } from "react";

import {
  EmptyState,
  ErrorMessage,
  Field,
  LoadingState,
} from "../components/StudioUI";

export type EntityProfileStatus = "not-controlled" | "setup-required" | "ready";

export interface EntityProfileFieldViewModel {
  id: string;
  label: string;
  helpText?: string | undefined;
  visibility: "table" | "controllers-and-facilitators";
  value?: string | undefined;
}

export interface EntityProfileViewModel {
  displayName: string;
  summary: string;
  characterStatus: EntityProfileStatus;
  fields: EntityProfileFieldViewModel[];
}

export interface EntityProfileIssue {
  kind: "connection" | "request";
  message: string;
  fieldErrors: Record<string, string | undefined>;
}

interface EntityProfileLoadIssue {
  kind: "connection" | "request";
  message: string;
}

export function EntityProfileLoadingView() {
  return <LoadingState label="Opening this character" />;
}

export function EntityProfileLoadErrorView({
  issue,
  onRetry,
}: {
  issue: EntityProfileLoadIssue;
  onRetry: () => void;
}) {
  return <ErrorMessage error={issue} onRetry={onRetry} />;
}

export function EntityProfileView({
  profile,
  editor,
}: {
  profile: EntityProfileViewModel;
  editor: ReactNode;
}) {
  return (
    <article className="entity-profile">
      <header>
        <div>
          <h2>{profile.displayName}</h2>
          <span>{profile.summary}</span>
        </div>
        <CharacterStatus status={profile.characterStatus} />
      </header>
      {editor ?? <EntityProfileReaderView fields={profile.fields} />}
    </article>
  );
}

export function EntityProfileEditorView({
  fields,
  values,
  saving,
  dirty,
  issue,
  onValueChange,
  onSubmit,
}: {
  fields: EntityProfileFieldViewModel[];
  values: Record<string, string>;
  saving: boolean;
  dirty: boolean;
  issue: EntityProfileIssue | null;
  onValueChange: (fieldId: string, value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="profile-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {fields.length === 0 ? (
        <EmptyState
          title="No character fields configured"
          description="A facilitator can publish required fields in Build. This controlled entity is ready without them."
        />
      ) : (
        <div className="character-profile-fields">
          {fields.map((characterField) => (
            <Field
              key={characterField.id}
              label={characterField.label}
              hint={characterField.helpText}
              error={issue?.fieldErrors[characterField.id]}
            >
              <textarea
                value={values[characterField.id] ?? ""}
                rows={6}
                maxLength={20_000}
                placeholder={`Write ${characterField.label.toLowerCase()}…`}
                onChange={(event) =>
                  onValueChange(characterField.id, event.currentTarget.value)
                }
              />
              <span className="character-field-visibility">
                {characterField.visibility === "table"
                  ? "Visible to everyone at the table"
                  : "Visible only to controllers and facilitators"}
              </span>
            </Field>
          ))}
        </div>
      )}
      {issue === null ? null : <ErrorMessage error={issue} />}
      {fields.length > 0 ? (
        <footer>
          <span>
            Drafts may be incomplete. Every field is required before play.
          </span>
          <button
            className="button button-ink"
            type="submit"
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : "Save character"}
          </button>
        </footer>
      ) : null}
    </form>
  );
}

function CharacterStatus({ status }: { status: EntityProfileStatus }) {
  if (status === "not-controlled")
    return (
      <span className="character-status status-neutral">Uncontrolled</span>
    );
  if (status === "ready")
    return <span className="character-status status-ready">Ready</span>;
  return <span className="character-status status-setup">Setup required</span>;
}

function EntityProfileReaderView({
  fields,
}: {
  fields: EntityProfileFieldViewModel[];
}) {
  if (fields.length === 0)
    return (
      <EmptyState
        title="No visible profile fields"
        description="There are no completed fields visible to you."
      />
    );
  return (
    <div className="profile-section-list">
      {fields.map((characterField) => (
        <section className="profile-section" key={characterField.id}>
          <header>
            <h3>{characterField.label}</h3>
            {characterField.visibility === "controllers-and-facilitators" ? (
              <span>Private</span>
            ) : null}
          </header>
          <p>{characterField.value}</p>
        </section>
      ))}
    </div>
  );
}
