import { toErrorNotice } from "../api/client";
import type { AuthenticatedSession, User, WorldTemplate } from "../api/types";
import { useCollection } from "../hooks/useCollection";
import type { Navigate } from "../worldRoutes";
import { AccountControls } from "./AccountControls";
import { WorldTemplateLibraryView } from "./WorldTemplateLibraryView";
import { useWorldTemplateStartTools } from "./worldTemplateStartTools";

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
  const siteTools = useWorldTemplateStartTools(navigate);
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
        siteTools,
      }}
      accountControls={
        <AccountControls
          user={user}
          onLogout={onLogout}
          onLogoutAll={onLogoutAll}
          onSessionChanged={onSessionChanged}
        />
      }
    />
  );
}
