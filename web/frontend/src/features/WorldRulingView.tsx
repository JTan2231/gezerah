import { Avatar, ErrorMessage, Field } from "../components/StudioUI";
import type {
  RulingPreviewViewModel,
  RulingViewActions,
  RulingViewModel,
} from "./WorldPlayViewModel";

export function RulingView({
  model,
  actions,
}: {
  model: RulingViewModel;
  actions: RulingViewActions;
}) {
  return (
    <section className="ruling-editor">
      <header>
        <h3>What transpires?</h3>
        <p>
          Describe the outcome in plain language. Luna will translate it into
          the world’s mechanics.
        </p>
      </header>
      {model.submissions.length > 0 ? (
        <section className="consequence-actions" aria-label="Submitted actions">
          <h4>Actions to consider</h4>
          <div className="action-list">
            {model.submissions.map((submission) => (
              <blockquote key={submission.id}>
                <Avatar name={submission.actorName} size="small" />
                <div>
                  <strong>{submission.actorName}</strong>
                  <p>{submission.text}</p>
                </div>
              </blockquote>
            ))}
          </div>
        </section>
      ) : null}
      <Field
        label="What transpires"
        hint="Include the fictional outcome and any lasting or mechanical consequences."
        error={model.issue?.fields["narrative"]}
      >
        <textarea
          value={model.narrative}
          onChange={(event) =>
            actions.changeNarrative(event.currentTarget.value)
          }
          rows={6}
          maxLength={20_000}
          placeholder="Describe everything that happens as a result of these actions."
        />
      </Field>
      {model.preview === null ? null : (
        <>
          {model.selectedAction === null ? null : (
            <p className="compiled-action-summary">
              Centered on <strong>{model.selectedAction.actorName}</strong>:{" "}
              {model.selectedAction.text}
            </p>
          )}
          <RulingPreviewView model={model.preview} />
        </>
      )}
      {!model.rulesReady ? (
        <p className="ruling-sync-notice" role="status">
          Refreshing the current rules and entity state before this consequence
          can be interpreted or resolved.
        </p>
      ) : model.previewStale ? (
        <p className="ruling-sync-notice" role="status">
          The outcome or table changed after this preview was prepared. Prepare
          it again before resolving.
        </p>
      ) : null}
      {model.issue === null ? null : <ErrorMessage error={model.issue} />}
      <footer className="ruling-actions">
        <button
          className="button button-quiet"
          type="button"
          disabled={
            model.saving !== null ||
            model.narrative.trim() === "" ||
            !model.rulesReady
          }
          onClick={actions.prepare}
        >
          {model.saving === "compile"
            ? "Interpreting…"
            : model.preview === null
              ? "Compile & preview"
              : "Compile again"}
        </button>
        <button
          className="button button-play"
          type="button"
          disabled={
            model.saving !== null || model.preview === null || !model.rulesReady
          }
          onClick={actions.resolve}
        >
          {model.saving === "resolve" ? "Resolving…" : "Resolve problem"}
        </button>
      </footer>
    </section>
  );
}

function RulingPreviewView({ model }: { model: RulingPreviewViewModel }) {
  return (
    <div className="ruling-preview" role="status" aria-live="polite">
      <header>
        <div>
          <strong>Preview is valid</strong>
          <small>{model.applicationSummary}</small>
        </div>
      </header>
      {model.applications.length > 0 ? (
        <div>
          {model.applications.map((application) => (
            <p key={application.id}>
              <strong>{application.entityName}</strong>
              <span>{application.effectLabel}</span>
              <em>{application.outcomeLabel}</em>
            </p>
          ))}
        </div>
      ) : null}
      {model.effectiveChanges.length > 0 ? (
        <div className="effective-change-list">
          <strong>Final calculated changes</strong>
          {model.effectiveChanges.map((change) => (
            <p key={change.id}>
              <span>{change.label}</span>
              <em>{change.outcomeLabel}</em>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
