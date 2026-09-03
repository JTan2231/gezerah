import type { ReactNode } from "react";

import {
  Avatar,
  Brand,
  ErrorMessage,
  LoadingState,
  type ErrorNotice,
} from "../components/StudioUI";
import type { SiteToolRegistrationState } from "./siteTools";

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
  siteTools: SiteToolRegistrationState;
}

export function WorldTemplateLibraryView({
  model,
  accountControls,
}: {
  model: WorldTemplateLibraryViewModel;
  accountControls: ReactNode;
}) {
  return (
    <div className="library-page play-library-page world-template-library-page">
      <header className="library-topbar">
        <span className="library-brand-button" aria-label="Wrought">
          <Brand compact />
        </span>
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
        <header className="library-heading template-library-heading">
          <div>
            <h1>Starting with ChatGPT</h1>
            <p>
              This attached page is a reference for delegated start. ChatGPT
              will recommend a World and Character, make your editable copy, and
              begin Play.
            </p>
          </div>
        </header>

        <section className="panel" aria-live="polite">
          <h2>Start site-tool surface</h2>
          <p>{siteToolStatus(model.siteTools)}</p>
          {model.siteTools.status === "failed" ? (
            <p>
              Delegated start is unavailable because the complete Start tool
              surface did not register.
            </p>
          ) : null}
        </section>

        {model.loading ? <LoadingState label="Loading World choices" /> : null}
        {model.catalogIssue === null ? null : (
          <ErrorMessage error={model.catalogIssue} />
        )}

        <div className="world-template-grid">
          {model.templates.map((template) => {
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
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function siteToolStatus(siteTools: SiteToolRegistrationState): string {
  switch (siteTools.status) {
    case "unsupported":
      return "Start site-tool surface is unsupported in this browser, so delegated start is unavailable here.";
    case "unavailable":
      return "Start site-tool surface is unavailable on this page.";
    case "registering":
      return "Start site-tool surface is registering.";
    case "ready":
      return "Start site-tool surface is ready. ChatGPT can inspect the complete World catalog and start your copy.";
    case "failed":
      return `Start site-tool surface failed: ${siteTools.registeredToolNames.length} of 2 registrations succeeded before teardown; complete surface not ready.`;
  }
}
