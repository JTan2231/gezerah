import type { ReactNode } from "react";

import {
  Avatar,
  EmptyState,
  ErrorMessage,
  LoadingState,
} from "../components/StudioUI";
import type {
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
          <p>Dungeon Master: {model.dungeonMaster.name}</p>
        </div>
        <div className="play-header-actions">
          {model.dungeonMaster.canChange ? (
            <label className="dungeon-master-picker">
              <span>Dungeon Master</span>
              <select
                value={model.dungeonMaster.selectedValue}
                disabled={model.dungeonMaster.changing}
                onChange={(event) =>
                  actions.changeFacilitator(event.currentTarget.value)
                }
              >
                {model.dungeonMaster.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.name}
                  </option>
                ))}
              </select>
              {model.dungeonMaster.changing ? (
                <small role="status">Handing off…</small>
              ) : null}
            </label>
          ) : (
            <div className="table-role dungeon-master-role">
              <Avatar name={model.dungeonMaster.name} size="small" />
              <span>
                <small>Dungeon Master</small>
                <strong>{model.dungeonMaster.name}</strong>
              </span>
            </div>
          )}
          {model.dungeonMaster.canTakeOver ? (
            <button
              className="button button-ink"
              type="button"
              disabled={model.dungeonMaster.changing}
              onClick={actions.takeOverFacilitation}
            >
              {model.dungeonMaster.changing ? "Taking over…" : "Take over"}
            </button>
          ) : null}
          <div className="table-role">
            <Avatar name={model.currentUserName} size="small" />
            <span>
              <small>Your role</small>
              <strong>{model.roleLabel}</strong>
              <small>World access: {model.accessLabel}</small>
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
      {model.dungeonMaster.issue === null ? null : (
        <div className="play-header-issue">
          <ErrorMessage error={model.dungeonMaster.issue} />
        </div>
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
              onRetry={actions.retryRoster}
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
          <div className="table-members">
            <p>{model.roster.readyMembers.length} active members</p>
            <div>
              {model.roster.readyMembers.slice(0, 6).map((member) => (
                <Avatar key={member.id} name={member.name} size="small" />
              ))}
            </div>
          </div>
        </aside>

        <main className="table-stage">
          {model.problems.loading && !model.hasActiveProblem ? (
            <LoadingState label="Loading problems" />
          ) : null}
          {model.problems.issue === null ? null : (
            <ErrorMessage
              error={model.problems.issue}
              onRetry={actions.retryProblems}
            />
          )}
          {model.hasActiveProblem ? (
            slots.activeProblem
          ) : (
            <IdleTableView
              facilitator={model.facilitator}
              canCreate={model.canCreateProblem}
              terraFacilitated={model.idle.terraFacilitated}
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
          <p>
            {model.currentUserName}, complete all required fields for a
            controlled character before entering Play.
          </p>
          <p>Dungeon Master: {model.dungeonMasterName}</p>
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
        <LoadingState label="Loading characters" />
      ) : null}
      {model.issue === null ? null : (
        <ErrorMessage error={model.issue} onRetry={actions.retry} />
      )}
      {!model.loading && model.characters.length === 0 ? (
        <div className="onboarding-waiting panel">
          <EmptyState
            title="No character assigned"
            description="An owner or editor must create an entity and assign you as a controller."
          />
        </div>
      ) : null}

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

function IdleTableView({
  facilitator,
  canCreate,
  terraFacilitated,
  canContinue,
  continuing,
  issue,
  onCreate,
  onContinue,
}: {
  facilitator: boolean;
  canCreate: boolean;
  terraFacilitated: boolean;
  canContinue: boolean;
  continuing: boolean;
  issue: WorldPlayViewModel["idle"]["issue"];
  onCreate: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="idle-table">
      <h2>No active problem</h2>
      <p>
        {terraFacilitated && continuing
          ? "Terra is preparing the next problem from the current world and table history."
          : terraFacilitated
            ? "Terra Auto DM is running the table. A ready player can ask Terra to continue."
            : facilitator && !canCreate
              ? "This world is archived."
              : facilitator
                ? "Create a problem to begin."
                : "A facilitator can create the next problem."}
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
              ? "Ask Terra to continue"
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
  if (item.outcome === "cancelled")
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
          {item.effects.length > 0 ? (
            <div className="history-effects">
              {item.effects.map((effect) => (
                <span key={effect.id}>{effect.label}</span>
              ))}
            </div>
          ) : null}
          {item.effectiveChanges.length > 0 ? (
            <div className="history-effective-changes">
              <strong>Final values</strong>
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
