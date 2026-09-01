import { useRef, useState } from "react";

import { api, ApiError, jsonBody, toErrorNotice } from "../api/client";
import type {
  AuthenticatedSession,
  User,
  World,
  WorldTemplate,
} from "../api/types";
import { useCollection } from "../hooks/useCollection";
import { playWorldURL, type Navigate } from "../worldRoutes";
import { AccountControls } from "./AccountControls";
import { WorldTemplateLibraryView } from "./WorldTemplateLibraryView";

interface CloneAttempt {
  templateID: string;
  destinationWorldID: string;
  saving: boolean;
  error: ApiError | null;
}

export function WorldTemplateLibrary({
  user,
  navigate,
  onLogout,
  onLogoutAll,
  onSessionChanged,
}: {
  user: User;
  navigate: Navigate;
  onLogout: () => Promise<void>;
  onLogoutAll: () => Promise<void>;
  onSessionChanged: (session: AuthenticatedSession) => void;
}) {
  const templates = useCollection<WorldTemplate>("/api/world-templates");
  const [cloneAttempt, setCloneAttempt] = useState<CloneAttempt | null>(null);
  const cloneAttemptRef = useRef<CloneAttempt | null>(null);
  const invalidCatalog =
    !templates.loading &&
    templates.error === null &&
    templates.items.length !== 3;
  const catalogIssue =
    templates.error === null
      ? invalidCatalog
        ? {
            kind: "request" as const,
            message: "The complete set of World choices is not available.",
          }
        : null
      : toErrorNotice(templates.error);

  async function cloneTemplate(templateID: string) {
    if (cloneAttemptRef.current?.saving === true) return;
    const previous = cloneAttemptRef.current;
    const attempt: CloneAttempt = {
      templateID,
      destinationWorldID:
        previous?.templateID === templateID
          ? previous.destinationWorldID
          : window.crypto.randomUUID(),
      saving: true,
      error: null,
    };
    cloneAttemptRef.current = attempt;
    setCloneAttempt(attempt);
    try {
      const world = await api<World>(
        `/api/world-templates/${encodeURIComponent(templateID)}/clone`,
        {
          method: "POST",
          ...jsonBody({ id: attempt.destinationWorldID }),
        },
      );
      navigate(playWorldURL(world.id), { replace: true });
    } catch (reason) {
      const failedAttempt = {
        ...attempt,
        saving: false,
        error:
          reason instanceof ApiError
            ? reason
            : new ApiError(0, "unknown", "Could not create your World."),
      };
      cloneAttemptRef.current = failedAttempt;
      setCloneAttempt(failedAttempt);
    }
  }

  return (
    <WorldTemplateLibraryView
      model={{
        account: {
          displayName: user.display_name,
          username: user.username,
        },
        templates: invalidCatalog
          ? []
          : templates.items.map((template) => ({
              id: template.id,
              name: template.name,
              description: template.description,
              setting: template.setting,
              characterCount: template.character_count,
            })),
        loading: templates.loading,
        catalogIssue,
        copyingTemplateID:
          cloneAttempt?.saving === true ? cloneAttempt.templateID : undefined,
        failedTemplateID:
          cloneAttempt?.error === null || cloneAttempt === null
            ? undefined
            : cloneAttempt.templateID,
        cloneIssue:
          cloneAttempt?.error === null || cloneAttempt === null
            ? null
            : toErrorNotice(cloneAttempt.error),
      }}
      accountControls={
        <AccountControls
          user={user}
          onLogout={onLogout}
          onLogoutAll={onLogoutAll}
          onSessionChanged={onSessionChanged}
        />
      }
      actions={{
        returnHome: () => navigate("/"),
        returnToWorlds: () => navigate("/play"),
        retryCatalog: templates.reload,
        copyTemplate: (templateID) => void cloneTemplate(templateID),
      }}
    />
  );
}
