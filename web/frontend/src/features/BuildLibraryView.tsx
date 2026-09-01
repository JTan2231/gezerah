import type { ReactNode } from "react";

import {
  Avatar,
  Brand,
  EmptyState,
  ErrorMessage,
  Field,
  LoadingState,
  Modal,
  RolePill,
} from "../components/StudioUI";
import {
  ChatGPTWorldStartView,
  type ChatGPTWorldStartViewProps,
} from "./ChatGPTWorldStartView";

export interface LibraryIssue {
  kind: "connection" | "request";
  message: string;
}

export interface BuildLibraryWorld {
  id: string;
  name: string;
  description: string;
  role: "owner" | "editor";
  status: "active" | "archived";
  memberCount: number;
  capacityCount: number;
  capabilityCount: number;
  lastActive: string;
}

export interface BuildLibraryViewModel {
  account: {
    displayName: string;
    username: string;
  };
  worlds: readonly BuildLibraryWorld[];
  loading: boolean;
  issue: LibraryIssue | null;
}

export interface BuildLibraryViewActions {
  returnHome: () => void;
  createWorld: () => void;
  openWorld: (worldID: string) => void;
  retry: () => void;
}

export function BuildLibraryView({
  model,
  actions,
  worldStart,
  accountControls,
  createWorldDialog,
}: {
  model: BuildLibraryViewModel;
  actions: BuildLibraryViewActions;
  worldStart: ChatGPTWorldStartViewProps;
  accountControls: ReactNode;
  createWorldDialog: ReactNode;
}) {
  return (
    <div className="library-page build-library-page">
      <header className="library-topbar">
        <button
          className="library-brand-button"
          type="button"
          onClick={actions.returnHome}
          aria-label="Return home"
        >
          <Brand compact />
        </button>
        <div className="account-menu">
          <Avatar name={model.account.displayName} size="small" />
          <span className="account-copy">
            <strong>{model.account.displayName}</strong>
            <small>@{model.account.username}</small>
          </span>
          {accountControls}
        </div>
      </header>

      <main className="library-main">
        <header className="library-heading">
          <div>
            <h1>Worlds</h1>
            <p>Worlds you can edit.</p>
          </div>
          <button
            className="button button-primary"
            type="button"
            onClick={actions.createWorld}
          >
            Create world
          </button>
        </header>

        <ChatGPTWorldStartView {...worldStart} />

        {model.loading ? <LoadingState label="Loading worlds" /> : null}
        {model.issue === null ? null : (
          <ErrorMessage error={model.issue} onRetry={actions.retry} />
        )}
        {!model.loading && model.issue === null && model.worlds.length === 0 ? (
          <EmptyState
            title="No worlds"
            description="Create a world to configure its Mechanics and issue membership invitations."
            action={
              <button
                className="button button-primary"
                type="button"
                onClick={actions.createWorld}
              >
                Create world
              </button>
            }
          />
        ) : null}

        <div className="world-grid">
          {model.worlds.map((world) => (
            <article className="world-card" key={world.id}>
              <header>
                <RolePill role={world.role} />
                <span
                  className={
                    world.status === "active"
                      ? "world-status"
                      : "world-status world-status-archived"
                  }
                >
                  {world.status}
                </span>
              </header>
              <button
                className="world-card-title"
                type="button"
                onClick={() => actions.openWorld(world.id)}
              >
                <span>
                  <strong>{world.name}</strong>
                  <small>{world.description}</small>
                </span>
              </button>
              <dl className="world-stats">
                <div>
                  <dt>Members</dt>
                  <dd>{world.memberCount}</dd>
                </div>
                <div>
                  <dt>Capacities</dt>
                  <dd>{world.capacityCount}</dd>
                </div>
                <div>
                  <dt>Capabilities</dt>
                  <dd>{world.capabilityCount}</dd>
                </div>
              </dl>
              <footer>
                <span>Active {world.lastActive}</span>
                <div>
                  <button
                    className="button button-ink"
                    type="button"
                    onClick={() => actions.openWorld(world.id)}
                  >
                    Open
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      </main>

      {createWorldDialog}
    </div>
  );
}

type CreateWorldIssue = LibraryIssue;

export function CreateWorldView({
  model,
  actions,
}: {
  model: {
    name: string;
    description: string;
    saving: boolean;
    issue: CreateWorldIssue | null;
    nameIssue?: string | undefined;
  };
  actions: {
    changeName: (name: string) => void;
    changeDescription: (description: string) => void;
    close: () => void;
    submit: () => void;
  };
}) {
  return (
    <Modal
      title="Create a world"
      description="Enter a name. You can configure mechanics after creation."
      onClose={actions.close}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          actions.submit();
        }}
      >
        <Field label="World name" error={model.nameIssue}>
          <input
            value={model.name}
            onChange={(event) => actions.changeName(event.currentTarget.value)}
            maxLength={200}
            placeholder="World name"
          />
        </Field>
        <Field label="Short description" hint="Optional.">
          <textarea
            value={model.description}
            onChange={(event) =>
              actions.changeDescription(event.currentTarget.value)
            }
            rows={3}
            placeholder="World description"
          />
        </Field>
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
            className="button button-primary"
            type="submit"
            disabled={model.saving}
          >
            {model.saving ? "Creating…" : "Create world"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
