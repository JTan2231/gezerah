import type { ReactNode } from "react";

import {
  Avatar,
  EmptyState,
  ErrorMessage,
  LoadingState,
} from "../components/StudioUI";
import type {
  AgentModeViewModel,
  CharacterOnboardingViewActions,
  CharacterOnboardingViewModel,
  HistoryCardViewModel,
  LiveInteractionViewModel,
  WorldPlayBoundaryViewModel,
  WorldPlayViewActions,
  WorldPlayViewModel,
  WorldPlayViewSlots,
} from "./WorldPlayViewModel";

export function WorldPlayBoundaryView({
  model,
  onRetry,
}: {
  model: WorldPlayBoundaryViewModel;
  onRetry?: (() => void) | undefined;
}) {
  if (model.kind === "loading") return <LoadingState label={model.label} />;
  if (model.kind === "issue")
    return (
      <ErrorMessage
        error={model.issue}
        {...(onRetry === undefined ? {} : { onRetry })}
      />
    );
  return <EmptyState title={model.title} description={model.description} />;
}

export function WorldPlayView({
  model,
  actions,
  slots,
}: {
  model: WorldPlayViewModel;
  actions: WorldPlayViewActions;
  slots: WorldPlayViewSlots;
}) {
  return (
    <section className="play-page">
      <header className="play-header">
        <div>
          <h1>{model.worldName}</h1>
          <p>Facilitator: {model.facilitatorAssignment.name}</p>
        </div>
        <div className="play-header-actions">
          {model.facilitatorAssignment.canChange ? (
            <label className="facilitator-picker">
              <span>Facilitator</span>
              <select
                value={model.facilitatorAssignment.selectedValue}
                disabled={model.facilitatorAssignment.changing}
                onChange={(event) =>
                  actions.changeFacilitator(event.currentTarget.value)
                }
              >
                {model.facilitatorAssignment.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.name}
                  </option>
                ))}
              </select>
              {model.facilitatorAssignment.changing ? (
                <small role="status">Reassigning…</small>
              ) : null}
            </label>
          ) : (
            <div className="play-role facilitator-role">
              <Avatar name={model.facilitatorAssignment.name} size="small" />
              <span>
                <small>Facilitator</small>
                <strong>{model.facilitatorAssignment.name}</strong>
              </span>
            </div>
          )}
          {model.facilitatorAssignment.canTakeOver ? (
            <button
              className="button button-ink"
              type="button"
              disabled={model.facilitatorAssignment.changing}
              onClick={actions.takeOverFacilitation}
            >
              {model.facilitatorAssignment.changing
                ? "Taking over…"
                : "Take over"}
            </button>
          ) : null}
          <div className="play-role">
            <Avatar name={model.currentUserName} size="small" />
            <span>
              <small>Your current play role</small>
              <strong>{model.currentPlayRoleLabel}</strong>
              <small>Membership role: {model.membershipRoleLabel}</small>
            </span>
          </div>
          {model.canCreateProblem ? (
            <button
              className="button button-play"
              type="button"
              onClick={actions.createProblem}
              disabled={model.hasActiveProblem}
            >
              New problem
            </button>
          ) : null}
        </div>
      </header>
      {model.facilitatorAssignment.issue === null ? null : (
        <div className="play-header-issue">
          <ErrorMessage error={model.facilitatorAssignment.issue} />
        </div>
      )}

      {model.agentMode === null ? null : (
        <AgentModeNotice model={model.agentMode} />
      )}

      <div className="play-grid">
        <aside className="roster-panel">
          <header>
            <h2>Entities</h2>
          </header>
          {model.roster.loading && model.roster.entities.length === 0 ? (
            <LoadingState label="Loading roster" />
          ) : null}
          {model.roster.issue === null ? null : (
            <ErrorMessage
              error={model.roster.issue}
              {...(model.agentMode === null
                ? { onRetry: actions.retryRoster }
                : {})}
            />
          )}
          <div className="roster-list">
            {model.roster.entities.map((entity) => (
              <button
                className={[
                  "roster-item",
                  entity.selected ? "active" : "",
                  entity.controlled ? "roster-item-character" : "",
                  entity.setupRequired ? "roster-item-setup" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                type="button"
                key={entity.id}
                aria-pressed={entity.selected}
                onClick={() => actions.selectEntity(entity.id)}
              >
                <span className="entity-token" aria-hidden="true">
                  {entity.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{entity.name}</strong>
                  <small>{entity.subtitle}</small>
                </span>
                <b aria-hidden="true">›</b>
              </button>
            ))}
          </div>
          {model.roster.showEmpty ? (
            <div className="roster-empty">
              <strong>No entities</strong>
              <p>Create entities and generated sheets in Build.</p>
            </div>
          ) : null}
          <div className="roster-members">
            <p>
              {model.roster.playReadyMembers.length} play-ready{" "}
              {model.roster.playReadyMembers.length === 1
                ? "member"
                : "members"}
            </p>
            <div>
              {model.roster.playReadyMembers.slice(0, 6).map((member) => (
                <Avatar key={member.id} name={member.name} size="small" />
              ))}
            </div>
          </div>
        </aside>

        <main className="play-stage">
          {model.problems.loading && !model.hasActiveProblem ? (
            <LoadingState label="Loading problems" />
          ) : null}
          {model.problems.issue === null ? null : (
            <ErrorMessage
              error={model.problems.issue}
              {...(model.agentMode === null
                ? { onRetry: actions.retryProblems }
                : {})}
            />
          )}
          {model.hasActiveProblem ? (
            slots.activeProblem
          ) : (
            <IdlePlayView
              facilitator={model.facilitator}
              canCreate={model.canCreateProblem}
              terraFacilitated={model.idle.terraFacilitated}
              agentFacilitated={model.idle.agentFacilitated}
              canContinue={model.idle.canContinue}
              continuing={model.idle.continuing}
              issue={model.idle.issue}
              onCreate={actions.createProblem}
              onContinue={actions.continueWithTerra}
            />
          )}

          <HistoryFeedView items={model.history} />
        </main>

        <aside className="entity-sheet-panel">
          {slots.selectedEntity === null ? (
            <EmptyState
              title="No entity selected"
              description="Select an entity to view its profile and generated sheet."
            />
          ) : (
            slots.selectedEntity
          )}
        </aside>
      </div>

      {slots.problemDialog}
    </section>
  );
}

export function CharacterOnboardingView({
  model,
  actions,
  profile,
}: {
  model: CharacterOnboardingViewModel;
  actions: CharacterOnboardingViewActions;
  profile: ReactNode;
}) {
  return (
    <section className="character-onboarding-page">
      <header className="play-header onboarding-header">
        <div>
          <h1>{model.worldName}</h1>
          {model.waitingForCharacter ? (
            <p>
              {model.agentMode === null
                ? `Choose your character, ${model.currentUserName}. Meet the people available to play in this World.`
                : "ChatGPT is choosing the best-fitting available Character from your play preference."}
            </p>
          ) : (
            <p>
              {model.agentMode === null
                ? `${model.currentUserName}, complete all required fields for a controlled character before entering Play.`
                : "This Character requires setup, so delegated Play is unavailable."}
            </p>
          )}
          <p>Facilitator: {model.facilitatorName}</p>
        </div>
        <div className="play-header-actions">
          <span className="character-status status-setup">
            {model.statusLabel}
          </span>
          {model.canBecomeFacilitator ? (
            <button
              className="button button-ink"
              type="button"
              disabled={model.changingFacilitator}
              onClick={actions.becomeFacilitator}
            >
              {model.changingFacilitator
                ? "Taking over…"
                : model.facilitatorActionLabel}
            </button>
          ) : null}
        </div>
      </header>

      {model.facilitatorIssue === null ? null : (
        <ErrorMessage error={model.facilitatorIssue} />
      )}

      {model.loading && model.characters.length === 0 ? (
        <LoadingState label="Loading character setup" />
      ) : null}
      {model.issue === null ? null : (
        <ErrorMessage
          error={model.issue}
          {...(model.agentMode === null ? { onRetry: actions.retry } : {})}
        />
      )}
      {!model.loading && model.characters.length === 0 ? (
        model.availableEntities.length === 0 ? (
          <div className="onboarding-waiting panel">
            <EmptyState
              title={
                model.agentMode === null
                  ? "No character assigned"
                  : "No character available"
              }
              description={
                model.agentMode === null
                  ? "An owner or editor must create an entity and assign you as a controller."
                  : "There are no unclaimed characters available in this World."
              }
            />
          </div>
        ) : (
          <section className="panel available-entities">
            <header>
              <h2>Meet the characters</h2>
              <p>
                {model.agentMode === null
                  ? "Choose one to make them your Character in this saved World."
                  : "ChatGPT can inspect these Characters and claim the closest match."}
              </p>
            </header>
            <div className="available-entity-list">
              {model.availableEntities.map((entity) => (
                <article key={entity.id}>
                  <span className="entity-token" aria-hidden="true">
                    {entity.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{entity.name}</strong>
                    {entity.summary === undefined ? null : (
                      <p>{entity.summary}</p>
                    )}
                  </div>
                  {model.agentMode === null ? (
                    <button
                      className="button button-play"
                      type="button"
                      disabled={model.claimingEntityId !== undefined}
                      onClick={() => actions.claimEntity(entity.id)}
                    >
                      {model.claimingEntityId === entity.id
                        ? `Choosing ${entity.name}…`
                        : `Play as ${entity.name}`}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
            {model.claimIssue === null ? null : (
              <ErrorMessage error={model.claimIssue} />
            )}
          </section>
        )
      ) : null}

      {model.agentMode === null ? null : (
        <AgentModeNotice model={model.agentMode} />
      )}

      {profile === null ? null : (
        <div className="onboarding-layout">
          {model.characters.length > 1 ? (
            <aside className="panel onboarding-characters">
              <h2>Your characters</h2>
              {model.characters.map((character) => (
                <button
                  className={character.selected ? "active" : ""}
                  type="button"
                  key={character.id}
                  aria-pressed={character.selected}
                  onClick={() => actions.selectCharacter(character.id)}
                >
                  <span className="entity-token" aria-hidden="true">
                    {character.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{character.name}</strong>
                    <small>
                      {character.completedFieldCount} of{" "}
                      {character.requiredFieldCount} complete
                    </small>
                  </span>
                </button>
              ))}
            </aside>
          ) : null}
          <div className="panel onboarding-profile">{profile}</div>
        </div>
      )}
    </section>
  );
}

function IdlePlayView({
  facilitator,
  canCreate,
  terraFacilitated,
  agentFacilitated,
  canContinue,
  continuing,
  issue,
  onCreate,
  onContinue,
}: {
  facilitator: boolean;
  canCreate: boolean;
  terraFacilitated: boolean;
  agentFacilitated: boolean;
  canContinue: boolean;
  continuing: boolean;
  issue: WorldPlayViewModel["idle"]["issue"];
  onCreate: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="idle-play">
      <h2>No active Problem</h2>
      <p>
        {agentFacilitated
          ? "ChatGPT is facilitating Play. Continue Play in your ChatGPT conversation."
          : terraFacilitated && continuing
            ? "Terra is preparing the next Problem from the current World and recent history."
            : terraFacilitated
              ? "Terra is facilitating Play. A ready current player can ask Terra to present the next Problem."
              : facilitator && !canCreate
                ? "This world is archived."
                : facilitator
                  ? "Create a Problem to begin Play."
                  : "The Facilitator can create the next Problem."}
      </p>
      {issue === null ? null : <ErrorMessage error={issue} />}
      {terraFacilitated && canContinue ? (
        <button
          className="button button-play"
          type="button"
          disabled={continuing}
          onClick={onContinue}
        >
          {continuing
            ? "Terra is preparing…"
            : issue === null
              ? "Ask Terra for the next Problem"
              : "Try Terra again"}
        </button>
      ) : canCreate ? (
        <button className="button button-play" type="button" onClick={onCreate}>
          New problem
        </button>
      ) : null}
    </section>
  );
}

function AgentModeNotice({ model }: { model: AgentModeViewModel }) {
  return (
    <aside className="agent-mode-notice" aria-label="ChatGPT Facilitator">
      <div>
        <strong>ChatGPT is Facilitator</strong>
        <p>{agentSiteToolStatus(model.siteTools)}</p>
      </div>
    </aside>
  );
}

function agentSiteToolStatus(
  siteTools: AgentModeViewModel["siteTools"],
): string {
  switch (siteTools.status) {
    case "unsupported":
      return "Play site-tool surface is unsupported in this browser. Delegated Play is not ready.";
    case "unavailable":
      return "Play site-tool surface is unavailable for this page and current play role.";
    case "registering":
      return "Play site-tool surface is registering.";
    case "ready":
      return "Play site-tool surface is ready. ChatGPT can inspect and continue Play.";
    case "failed":
      return `Play site-tool surface failed: ${siteTools.registeredToolNames.length} of 5 registrations succeeded before teardown; complete surface not ready.`;
  }
}

export function LiveInteractionView({
  model,
  content,
  onCancel,
  onSkip,
}: {
  model: LiveInteractionViewModel;
  content: ReactNode;
  onCancel: () => void;
  onSkip: () => void;
}) {
  return (
    <article className="live-interaction">
      <header>
        <div>
          <span className={`interaction-status status-${model.status}`}>
            <i aria-hidden="true" />
            {model.statusLabel}
          </span>
          <span>Presented {model.presentedLabel}</span>
        </div>
        {model.facilitator ? (
          <button
            className="text-button danger-text"
            type="button"
            disabled={model.working}
            onClick={onCancel}
          >
            Cancel problem
          </button>
        ) : model.canSkip ? (
          <button
            className="text-button danger-text"
            type="button"
            disabled={model.skipping}
            onClick={onSkip}
          >
            {model.skipping ? "Skipping…" : "Skip problem"}
          </button>
        ) : null}
      </header>
      <div className="problem-prompt">
        <h2>{model.title}</h2>
        <p className="prompt-copy">{model.prompt}</p>
        {model.contextEntityNames.length > 0 ? (
          <div className="context-chips">
            {model.contextEntityNames.map((name, index) => (
              <span key={`${name}:${index}`}>{name}</span>
            ))}
          </div>
        ) : null}
      </div>

      {content}
      {model.issue === null ? null : <ErrorMessage error={model.issue} />}
    </article>
  );
}

function HistoryFeedView({ items }: { items: HistoryCardViewModel[] }) {
  if (items.length === 0) return null;
  return (
    <section className="history-feed">
      <header>
        <h2>History</h2>
      </header>
      {items.map((item) => (
        <HistoryCardView key={item.id} item={item} />
      ))}
    </section>
  );
}

function HistoryCardView({ item }: { item: HistoryCardViewModel }) {
  if (item.resolutionStatus === "cancelled")
    return (
      <article className="history-card history-cancelled">
        <header>
          <span>
            {item.cancellationLabel ?? "Cancelled"} · {item.facilitatorLabel}
          </span>
          <time>{item.occurredLabel}</time>
        </header>
        <h3>{item.title}</h3>
        <p>{item.prompt}</p>
      </article>
    );

  return (
    <article className="history-card">
      <header>
        <span>Resolved · {item.facilitatorLabel}</span>
        <time>{item.occurredLabel}</time>
      </header>
      <h3>{item.title}</h3>
      <p className="history-prompt">{item.prompt}</p>
      {item.narrative === undefined ? null : (
        <>
          <blockquote>{item.narrative}</blockquote>
          {item.applications.length > 0 ? (
            <div className="history-applications">
              {item.applications.map((application) => (
                <span key={application.id}>{application.label}</span>
              ))}
            </div>
          ) : null}
          {item.effectiveChanges.length > 0 ? (
            <div className="history-effective-changes">
              <strong>Effective changes</strong>
              {item.effectiveChanges.map((change) => (
                <span key={change.id}>{change.label}</span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
