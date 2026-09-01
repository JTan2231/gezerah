import type { ReactNode } from "react";

import {
  Avatar,
  Brand,
  ErrorMessage,
  LoadingState,
  type ErrorNotice,
} from "../components/StudioUI";

interface WorldTemplateChoice {
  id: string;
  name: string;
  description: string;
  setting: string;
  characterCount: number;
}

export interface WorldTemplateLibraryViewModel {
  account: {
    displayName: string;
    username: string;
  };
  templates: readonly WorldTemplateChoice[];
  loading: boolean;
  catalogIssue: ErrorNotice | null;
  copyingTemplateID?: string | undefined;
  failedTemplateID?: string | undefined;
  cloneIssue: ErrorNotice | null;
}

interface WorldTemplateLibraryViewActions {
  returnHome: () => void;
  returnToWorlds: () => void;
  retryCatalog: () => void;
  copyTemplate: (templateID: string) => void;
}

export function WorldTemplateLibraryView({
  model,
  actions,
  accountControls,
}: {
  model: WorldTemplateLibraryViewModel;
  actions: WorldTemplateLibraryViewActions;
  accountControls: ReactNode;
}) {
  return (
    <div className="library-page play-library-page world-template-library-page">
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
        <button
          className="template-library-back text-button"
          type="button"
          onClick={actions.returnToWorlds}
        >
          <span aria-hidden="true">←</span> All worlds
        </button>
        <header className="library-heading template-library-heading">
          <div>
            <h1>Choose a new world</h1>
            <p>
              We’ll make your own editable copy, then you’ll choose who to play.
            </p>
          </div>
        </header>

        {model.loading ? <LoadingState label="Loading World choices" /> : null}
        {model.catalogIssue === null ? null : (
          <ErrorMessage
            error={model.catalogIssue}
            onRetry={actions.retryCatalog}
          />
        )}
        {model.cloneIssue === null ? null : (
          <ErrorMessage
            error={model.cloneIssue}
            onRetry={() => {
              if (model.failedTemplateID !== undefined)
                actions.copyTemplate(model.failedTemplateID);
            }}
          />
        )}

        <div
          className="world-template-grid"
          aria-busy={model.copyingTemplateID !== undefined}
        >
          {model.templates.map((template) => {
            const copying = model.copyingTemplateID === template.id;
            const failed = model.failedTemplateID === template.id;
            return (
              <article className="world-template-card" key={template.id}>
                <header>
                  <span className="world-template-setting">
                    {template.setting}
                  </span>
                  <span className="world-template-character-count">
                    {template.characterCount}{" "}
                    {template.characterCount === 1 ? "character" : "characters"}
                  </span>
                </header>
                <div className="world-template-copy">
                  <h2>{template.name}</h2>
                  <p>{template.description}</p>
                </div>
                <footer>
                  <button
                    className="button button-play"
                    type="button"
                    disabled={model.copyingTemplateID !== undefined}
                    onClick={() => actions.copyTemplate(template.id)}
                  >
                    {copying
                      ? "Creating your copy…"
                      : failed
                        ? "Try again"
                        : "Copy and play"}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
