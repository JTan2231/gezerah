import {
  EmptyState,
  ErrorMessage,
  Field,
  LoadingState,
  PageIntro,
} from "../components/StudioUI";

export type CharacterFieldVisibility = "table" | "controllers-and-facilitators";

export interface CharacterFieldDraft {
  clientKey: string;
  label: string;
  helpText: string;
  visibility: CharacterFieldVisibility;
}

interface CharacterFieldsIssue {
  kind: "connection" | "request";
  message: string;
}

interface CharacterFieldsViewModel {
  schemaLabel: string;
  fields: readonly (CharacterFieldDraft & {
    labelIssue?: string | undefined;
    helpTextIssue?: string | undefined;
  })[];
  dirty: boolean;
  valid: boolean;
  saving: boolean;
  issue: CharacterFieldsIssue | null;
}

interface CharacterFieldsViewActions {
  updateField: (
    index: number,
    patch: Partial<
      Pick<CharacterFieldDraft, "label" | "helpText" | "visibility">
    >,
  ) => void;
  moveField: (index: number, direction: -1 | 1) => void;
  removeField: (index: number) => void;
  addField: () => void;
  publish: () => void;
}

export function CharacterFieldsLoadingView() {
  return <LoadingState label="Opening character fields" />;
}

export function CharacterFieldsLoadErrorView({
  issue,
  onRetry,
}: {
  issue: CharacterFieldsIssue;
  onRetry: () => void;
}) {
  return <ErrorMessage error={issue} onRetry={onRetry} />;
}

export function CharacterFieldsView({
  model,
  actions,
}: {
  model: CharacterFieldsViewModel;
  actions: CharacterFieldsViewActions;
}) {
  return (
    <section className="character-fields-page content-narrow">
      <PageIntro
        title="Character fields"
        description="Define the information every player-controlled character must complete before entering Play."
      />

      <form
        className="panel character-fields-form"
        onSubmit={(event) => {
          event.preventDefault();
          actions.publish();
        }}
      >
        <header>
          <div>
            <h2>Requirements</h2>
            <p>
              {model.fields.length} required{" "}
              {model.fields.length === 1 ? "field" : "fields"}
            </p>
          </div>
          <span>{model.schemaLabel}</span>
        </header>

        {model.fields.length === 0 ? (
          <EmptyState
            title="No character fields yet"
            description="Controlled entities are immediately ready until you publish at least one field."
          />
        ) : null}

        <div className="character-field-definition-list">
          {model.fields.map((characterField, index) => (
            <fieldset
              className="character-field-definition"
              key={characterField.clientKey}
            >
              <legend>Required field {index + 1}</legend>
              <div className="profile-section-actions">
                <button
                  className="text-button"
                  type="button"
                  disabled={index === 0}
                  aria-label={`Move character field ${index + 1} up`}
                  onClick={() => actions.moveField(index, -1)}
                >
                  ↑
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={index === model.fields.length - 1}
                  aria-label={`Move character field ${index + 1} down`}
                  onClick={() => actions.moveField(index, 1)}
                >
                  ↓
                </button>
                <button
                  className="text-button danger-text"
                  type="button"
                  onClick={() => actions.removeField(index)}
                >
                  Remove
                </button>
              </div>
              <Field label="Field label" error={characterField.labelIssue}>
                <input
                  value={characterField.label}
                  maxLength={200}
                  placeholder="Field label"
                  onChange={(event) =>
                    actions.updateField(index, {
                      label: event.currentTarget.value,
                    })
                  }
                />
              </Field>
              <Field
                label="Guidance"
                hint="Optional instructions shown while the player writes."
                error={characterField.helpTextIssue}
              >
                <textarea
                  value={characterField.helpText}
                  rows={3}
                  maxLength={2000}
                  placeholder="Instructions for this field"
                  onChange={(event) =>
                    actions.updateField(index, {
                      helpText: event.currentTarget.value,
                    })
                  }
                />
              </Field>
              <Field label="Who can read the answer?">
                <select
                  value={characterField.visibility}
                  onChange={(event) =>
                    actions.updateField(index, {
                      visibility: event.currentTarget
                        .value as CharacterFieldVisibility,
                    })
                  }
                >
                  <option value="table">Everyone at the table</option>
                  <option value="controllers-and-facilitators">
                    Character controllers and facilitators
                  </option>
                </select>
              </Field>
            </fieldset>
          ))}
        </div>

        {model.issue === null ? null : <ErrorMessage error={model.issue} />}
        <footer className="form-actions">
          <button
            className="button button-quiet"
            type="button"
            disabled={model.fields.length >= 50}
            onClick={actions.addField}
          >
            Add required field
          </button>
          <span>{model.dirty ? "Unpublished changes" : "Published"}</span>
          <button
            className="button button-primary"
            type="submit"
            disabled={!model.dirty || !model.valid || model.saving}
          >
            {model.saving ? "Publishing…" : "Publish requirements"}
          </button>
        </footer>
      </form>
    </section>
  );
}
