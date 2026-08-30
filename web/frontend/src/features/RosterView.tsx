import type { ReactNode } from "react";

import {
  EmptyState,
  ErrorMessage,
  LoadingState,
  PageIntro,
} from "../components/StudioUI";

interface RosterViewIssue {
  kind: "connection" | "request";
  message: string;
}

interface RosterEntityViewModel {
  id: string;
  displayName: string;
  subtitle: string;
}

export function RosterView({
  preparing,
  active,
  loading,
  issue,
  entities,
  selectedEntityId,
  detail,
  overlays,
  onCreateEntity,
  onRetry,
  onSelectEntity,
}: {
  preparing: boolean;
  active: boolean;
  loading: boolean;
  issue: RosterViewIssue | null;
  entities: RosterEntityViewModel[];
  selectedEntityId?: string | undefined;
  detail: ReactNode;
  overlays: ReactNode;
  onCreateEntity: () => void;
  onRetry: () => void;
  onSelectEntity: (entityId: string) => void;
}) {
  if (preparing) return <LoadingState label="Preparing the roster" />;

  return (
    <section className="roster-workspace content-narrow">
      <PageIntro
        title="Roster & sheets"
        description="Create ordinary World Entities, assign Controllers, complete profiles, and edit logical state before entering Play."
        actions={
          active ? (
            <button
              className="button button-primary"
              type="button"
              onClick={onCreateEntity}
            >
              Create entity
            </button>
          ) : undefined
        }
      />

      {loading && entities.length === 0 ? (
        <LoadingState label="Loading roster" />
      ) : null}
      {issue === null ? null : <ErrorMessage error={issue} onRetry={onRetry} />}

      {!loading && issue === null && entities.length === 0 ? (
        <div className="panel roster-builder-empty">
          <EmptyState
            title="No entities"
            description="Create an entity to generate a sheet from the active capacities and capabilities."
            action={
              active ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={onCreateEntity}
                >
                  Create the first entity
                </button>
              ) : undefined
            }
          />
        </div>
      ) : null}

      {entities.length > 0 ? (
        <div className="roster-builder-grid">
          <aside className="panel roster-builder-catalog">
            <header>
              <h2>Entities</h2>
              <span>{entities.length}</span>
            </header>
            <div className="roster-builder-list">
              {entities.map((entity) => (
                <button
                  className={entity.id === selectedEntityId ? "active" : ""}
                  type="button"
                  key={entity.id}
                  aria-pressed={entity.id === selectedEntityId}
                  onClick={() => onSelectEntity(entity.id)}
                >
                  <span>
                    <strong>{entity.displayName}</strong>
                    <small>{entity.subtitle}</small>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="builder-entity-detail">{detail}</div>
        </div>
      ) : null}
      {overlays}
    </section>
  );
}
