import { Avatar, ErrorMessage, Field, Modal } from "../components/StudioUI";
import type {
  NewProblemViewActions,
  NewProblemViewModel,
  OpenProblemViewActions,
  OpenProblemViewModel,
} from "./WorldPlayViewModel";

export function NewProblemView({
  model,
  actions,
}: {
  model: NewProblemViewModel;
  actions: NewProblemViewActions;
}) {
  return (
    <Modal
      title="New problem"
      description="Describe the problem and choose who can respond."
      onClose={actions.close}
    >
      <form
        className="modal-form problem-form"
        onSubmit={(event) => {
          event.preventDefault();
          actions.submit();
        }}
      >
        <Field label="Title" hint="Optional. Shown in history.">
          <input
            value={model.draft.title}
            onChange={(event) => actions.changeTitle(event.currentTarget.value)}
            maxLength={200}
            placeholder="Problem title"
          />
        </Field>
        <Field label="Description" error={model.issue?.fields["description"]}>
          <textarea
            value={model.draft.description}
            onChange={(event) =>
              actions.changeDescription(event.currentTarget.value)
            }
            rows={5}
            maxLength={10_000}
            placeholder="Describe the problem."
          />
        </Field>
        {model.showContextChoices ? (
          <fieldset className="choice-fieldset">
            <legend>
              Context entities <small>Optional</small>
            </legend>
            <div className="chip-picker">
              {model.contextEntities.map((entity) => (
                <label
                  key={entity.id}
                  className={
                    model.draft.selectedEntityIds.includes(entity.id)
                      ? "selected"
                      : ""
                  }
                >
                  <input
                    type="checkbox"
                    checked={model.draft.selectedEntityIds.includes(entity.id)}
                    onChange={() => actions.toggleContextEntity(entity.id)}
                  />
                  <span>{entity.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <fieldset className="choice-fieldset">
          <legend>Who may respond?</legend>
          <div className="responder-picker">
            {model.responders.length === 0 ? (
              <p>
                No active players are available. You can create a problem
                without responders.
              </p>
            ) : (
              model.responders.map((responder) => (
                <label key={responder.id}>
                  <input
                    type="checkbox"
                    checked={model.draft.selectedResponderIds.includes(
                      responder.id,
                    )}
                    onChange={() => actions.toggleResponder(responder.id)}
                  />
                  <Avatar name={responder.name} size="small" />
                  <span>{responder.name}</span>
                </label>
              ))
            )}
          </div>
        </fieldset>
        {model.issue === null ? null : <ErrorMessage error={model.issue} />}
        <footer className="modal-actions">
          <button
            className="button button-quiet"
            type="button"
            onClick={actions.close}
          >
            Cancel
          </button>
          <button
            className="button button-play"
            type="submit"
            disabled={model.saving || model.draft.description.trim() === ""}
          >
            {model.saving ? "Creating…" : "Create problem"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function OpenProblemView({
  model,
  actions,
}: {
  model: OpenProblemViewModel;
  actions: OpenProblemViewActions;
}) {
  return (
    <section className="action-stage">
      <header>
        <h3>Actions</h3>
        <p>
          {model.submissions.length === 0
            ? "No actions submitted"
            : `${model.submissions.length} ${model.submissions.length === 1 ? "action" : "actions"} submitted`}
        </p>
      </header>
      {model.submissions.length > 0 ? (
        <div className="action-list">
          {model.submissions.map((submission) => (
            <blockquote key={submission.id}>
              <Avatar name={submission.actorName} size="small" />
              <div>
                <strong>{submission.actorName}</strong>
                {submission.playerName === undefined ? null : (
                  <small>played by {submission.playerName}</small>
                )}
                <p>{submission.text}</p>
              </div>
            </blockquote>
          ))}
        </div>
      ) : null}
      {!model.facilitator && model.eligibleResponder ? (
        !model.actionSubmitted ? (
          <form
            className="action-composer"
            onSubmit={(event) => {
              event.preventDefault();
              actions.submitAction();
            }}
          >
            {model.controlledEntities.length === 0 ? null : (
              <Field label="Acting character">
                <select
                  value={model.actingEntityId}
                  onChange={(event) =>
                    actions.changeActingEntity(event.currentTarget.value)
                  }
                >
                  <option value="">No character attribution</option>
                  {model.controlledEntities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="What do you do?">
              <textarea
                value={model.actionText}
                onChange={(event) =>
                  actions.changeActionText(event.currentTarget.value)
                }
                rows={3}
                maxLength={10_000}
                placeholder="Describe your action."
              />
            </Field>
            <div className="action-composer-actions">
              <button
                className="button button-play"
                type="submit"
                disabled={model.saving || model.actionText.trim() === ""}
              >
                {model.saving ? "Submitting…" : "Submit action"}
              </button>
              {model.terraFacilitated ? (
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={model.saving}
                  onClick={actions.passAction}
                >
                  Pass
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="own-action">
            <span>Action submitted.</span>
            <button
              className="text-button"
              type="button"
              disabled={model.saving}
              onClick={actions.withdrawAction}
            >
              Withdraw
            </button>
          </div>
        )
      ) : null}
      {!model.facilitator && !model.eligibleResponder ? (
        <p className="observer-note">
          You are part of this problem’s audience, but not one of its
          responders.
        </p>
      ) : null}
      {model.facilitator ? (
        <div className="adjudicate-callout">
          <div>
            <p>
              <strong>Close actions</strong>
              <small>
                Players cannot submit or withdraw actions after you close them.
              </small>
            </p>
          </div>
          <button
            className="button button-ink"
            type="button"
            disabled={model.closing}
            onClick={actions.closeActions}
          >
            {model.closing ? "Closing…" : "Close actions"}
          </button>
        </div>
      ) : null}
      {model.terraFacilitated ? (
        <div className="adjudicate-callout terra-decision-callout">
          <div>
            <p>
              <strong>
                {model.allRespondersReady
                  ? "Terra can decide"
                  : "Waiting for every responder"}
              </strong>
              <small>{model.responseProgressLabel}</small>
            </p>
          </div>
          {model.canRequestDecision ? (
            <button
              className="button button-ink"
              type="button"
              disabled={
                !model.allRespondersReady ||
                !model.decisionEnabled ||
                model.deciding
              }
              onClick={actions.requestDecision}
            >
              {model.deciding ? "Terra is deciding…" : "Let Terra decide"}
            </button>
          ) : null}
        </div>
      ) : null}
      {model.issue === null ? null : <ErrorMessage error={model.issue} />}
    </section>
  );
}

export function TerraDecisionPendingView({
  retrying,
  issue,
  onRetry,
}: {
  retrying: boolean;
  issue: OpenProblemViewModel["issue"];
  onRetry: () => void;
}) {
  return (
    <section className="terra-decision-pending" aria-live="polite">
      <h3>
        {issue === null ? "Terra is deciding…" : "Terra couldn’t continue"}
      </h3>
      <p>
        {issue === null
          ? "Terra is considering the submitted actions and Luna is validating the mechanical outcome. If this appears stalled, any ready player can retry."
          : "The submitted actions remain locked. Any ready player can ask Terra to try again."}
      </p>
      {issue === null ? null : <ErrorMessage error={issue} />}
      <button
        className="button button-play"
        type="button"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying
          ? "Retrying…"
          : issue === null
            ? "Retry if stalled"
            : "Retry Terra"}
      </button>
    </section>
  );
}
