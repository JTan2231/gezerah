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
                    model.draft.selectedContextEntityIDs.includes(entity.id)
                      ? "selected"
                      : ""
                  }
                >
                  <input
                    type="checkbox"
                    checked={model.draft.selectedContextEntityIDs.includes(
                      entity.id,
                    )}
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
                No ready current players are available. You can create a Problem
                without Responders.
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
          {model.actions.length === 0
            ? "No actions submitted"
            : `${model.actions.length} ${model.actions.length === 1 ? "action" : "actions"} submitted`}
        </p>
      </header>
      {model.actions.length > 0 ? (
        <div className="action-list">
          {model.actions.map((action) => (
            <blockquote key={action.id}>
              <Avatar name={action.actorName} size="small" />
              <div>
                <strong>{action.actorName}</strong>
                {action.playerName === undefined ? null : (
                  <small>played by {action.playerName}</small>
                )}
                <p>{action.text}</p>
              </div>
            </blockquote>
          ))}
        </div>
      ) : null}
      {!model.facilitator &&
      !model.agentFacilitated &&
      model.eligibleResponder ? (
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
              {model.terraFacilitated || model.agentFacilitated ? (
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
                Responders cannot submit or withdraw Actions after you close
                them.
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
                {model.allRespondersActed
                  ? "Terra can decide"
                  : "Waiting for every responder"}
              </strong>
              <small>{model.actionProgressLabel}</small>
            </p>
          </div>
          {model.canRequestDecision ? (
            <button
              className="button button-ink"
              type="button"
              disabled={
                !model.allRespondersActed ||
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
      {model.agentFacilitated ? (
        <div className="adjudicate-callout agent-decision-callout">
          <div>
            <p>
              <strong>
                {model.allRespondersActed
                  ? "ChatGPT can resolve"
                  : "Waiting for every responder"}
              </strong>
              <small>
                {model.actionProgressLabel} Continue Play in ChatGPT.
              </small>
            </p>
          </div>
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
          ? "Terra is considering the submitted Actions and Luna is validating the mechanical Consequence. If this appears stalled, any ready current player can retry."
          : "The submitted Actions remain locked. Any ready current player can ask Terra to try again."}
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

export function AgentDecisionPendingView() {
  return (
    <section className="agent-decision-pending" aria-live="polite">
      <h3>ChatGPT resolution pending</h3>
      <p>
        ChatGPT can reinspect the current durable Play state and retry this
        Resolution. Submitted Actions remain locked until it succeeds.
      </p>
    </section>
  );
}
