import {
  ErrorMessage,
  Field,
  PageIntro,
  RolePill,
} from "../components/StudioUI";

export interface SettingsIssue {
  kind: "connection" | "request";
  message: string;
}

export interface SettingsViewModel {
  draft: {
    name: string;
    description: string;
    proseGuide: string;
  };
  dirty: boolean;
  busy: "saving" | "archiving" | null;
  issue: SettingsIssue | null;
  fieldIssues: {
    name?: string | undefined;
    proseGuide?: string | undefined;
  };
  access: {
    role: "owner" | "editor";
    memberCount: number;
    mechanicCount: number;
    status: "active" | "archived";
    facilitator: string;
  };
  canArchive: boolean;
}

export interface SettingsViewActions {
  changeName: (name: string) => void;
  changeDescription: (description: string) => void;
  changeProseGuide: (proseGuide: string) => void;
  save: () => void;
  archive: () => void;
}

export function SettingsView({
  model,
  actions,
}: {
  model: SettingsViewModel;
  actions: SettingsViewActions;
}) {
  const saving = model.busy === "saving";
  const archiving = model.busy === "archiving";

  return (
    <section className="settings-page content-narrow">
      <PageIntro
        title="Settings"
        description="Update world details or archive the world."
      />
      <div className="settings-layout">
        <form
          className="panel settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            actions.save();
          }}
        >
          <header>
            <h2>World details</h2>
          </header>
          <Field label="World name" error={model.fieldIssues.name}>
            <input
              value={model.draft.name}
              onChange={(event) =>
                actions.changeName(event.currentTarget.value)
              }
              maxLength={200}
              disabled={model.busy !== null}
            />
          </Field>
          <Field
            label="Description"
            hint="Describe the World for its members and Facilitator."
          >
            <textarea
              value={model.draft.description}
              onChange={(event) =>
                actions.changeDescription(event.currentTarget.value)
              }
              rows={4}
              disabled={model.busy !== null}
            />
          </Field>
          <Field
            label="Prose guide"
            hint="Describe how Problems and Consequences should sound: the narrator’s point of view, sentence rhythm, concrete details, and how in-world language should appear. This shapes the writing, not the World’s facts or rules."
            error={model.fieldIssues.proseGuide}
          >
            <textarea
              value={model.draft.proseGuide}
              onChange={(event) =>
                actions.changeProseGuide(event.currentTarget.value)
              }
              rows={8}
              disabled={model.busy !== null}
            />
          </Field>
          <div className="settings-facilitator-note">
            <span>Facilitator</span>
            <strong>{model.access.facilitator}</strong>
            <small>
              Hand off Facilitator responsibility from Play between Problems.
            </small>
          </div>
          {model.issue === null ? null : <ErrorMessage error={model.issue} />}
          <footer className="form-actions">
            <span>{model.dirty ? "Unsaved changes" : "Up to date"}</span>
            <button
              className="button button-primary"
              type="submit"
              disabled={
                !model.dirty ||
                model.busy !== null ||
                model.draft.name.trim() === ""
              }
            >
              {saving ? "Saving…" : "Save details"}
            </button>
          </footer>
        </form>

        <aside className="settings-summary">
          <h2>Access</h2>
          <RolePill role={model.access.role} />
          <p>
            {model.access.role === "owner"
              ? "You can configure mechanics, invite members, assign the Facilitator, and archive this world."
              : "You can configure mechanics and assign the Facilitator."}
          </p>
          <dl>
            <div>
              <dt>Members</dt>
              <dd>{model.access.memberCount}</dd>
            </div>
            <div>
              <dt>Mechanics</dt>
              <dd>{model.access.mechanicCount}</dd>
            </div>
            <div>
              <dt>Facilitator</dt>
              <dd>{model.access.facilitator}</dd>
            </div>
            <div>
              <dt>World status</dt>
              <dd>{model.access.status}</dd>
            </div>
          </dl>
        </aside>
      </div>

      {model.canArchive ? (
        <section className="panel danger-zone">
          <div>
            <h2>Archive world</h2>
            <p>
              Archiving keeps every Entity, resolved Problem, and Resolution
              receipt readable. Active Problems must be resolved or cancelled
              first.
            </p>
          </div>
          <button
            className="button button-danger"
            type="button"
            onClick={actions.archive}
            disabled={model.busy !== null}
          >
            {archiving ? "Archiving…" : "Archive world"}
          </button>
        </section>
      ) : null}
    </section>
  );
}
