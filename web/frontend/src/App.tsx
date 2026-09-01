import { useCallback, useEffect, useRef, useState } from "react";

import {
  api,
  ApiError,
  clearAuthentication,
  onAuthenticationRequired,
  setCSRFToken,
  toErrorNotice,
} from "./api/client";
import type { AuthenticatedSession, User } from "./api/types";
import { AppFailureView, AppLoadingView } from "./AppView";
import { HomeChoice } from "./features/HomeChoice";
import { IdentityGate } from "./features/IdentityGate";
import { InvitePage } from "./features/InvitePage";
import { NotFoundPage } from "./features/NotFoundPage";
import { PlayLibrary } from "./features/PlayLibrary";
import { PlayWorkspace } from "./features/PlayWorkspace";
import { WorldTemplateLibrary } from "./features/WorldTemplateLibrary";
import { BuildLibrary } from "./features/BuildLibrary";
import { BuildWorkspace } from "./features/BuildWorkspace";
import { readLocation, type Navigate } from "./worldRoutes";

type AuthenticationStatus =
  "checking" | "authenticated" | "anonymous" | "error";

export default function App() {
  const [authenticationStatus, setAuthenticationStatus] =
    useState<AuthenticationStatus>("checking");
  const [user, setUser] = useState<User | null>(null);
  const [authenticationError, setAuthenticationError] =
    useState<ApiError | null>(null);
  const [authenticationNotice, setAuthenticationNotice] = useState<
    string | undefined
  >();
  const [location, setLocation] = useState(readLocation);
  const userRef = useRef<User | null>(null);
  const identityRequired =
    location.type !== "home" &&
    location.type !== "redirect" &&
    location.type !== "not-found";

  const establishSession = useCallback((session: AuthenticatedSession) => {
    setCSRFToken(session.csrf_token, session.user.id);
    userRef.current = session.user;
    setUser(session.user);
    setAuthenticationStatus("authenticated");
    setAuthenticationError(null);
    setAuthenticationNotice(undefined);
  }, []);

  const endSession = useCallback((notice?: string) => {
    clearAuthentication();
    userRef.current = null;
    setUser(null);
    setAuthenticationStatus("anonymous");
    setAuthenticationError(null);
    setAuthenticationNotice(notice);
  }, []);

  useEffect(
    () =>
      onAuthenticationRequired(() => {
        endSession(
          userRef.current === null
            ? undefined
            : "Your session ended. Sign in again to continue.",
        );
      }),
    [endSession],
  );

  useEffect(() => {
    if (!identityRequired || authenticationStatus !== "checking")
      return undefined;
    const controller = new AbortController();
    setAuthenticationError(null);
    void api<AuthenticatedSession>("/api/me", { signal: controller.signal })
      .then(establishSession)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 401) {
          endSession();
          return;
        }
        setAuthenticationStatus("error");
        setAuthenticationError(
          reason instanceof ApiError
            ? reason
            : new ApiError(0, "unknown", "Could not open your account."),
        );
      });
    return () => controller.abort();
  }, [authenticationStatus, endSession, establishSession, identityRequired]);

  useEffect(() => {
    function handlePopState() {
      setLocation(readLocation());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (location.type !== "redirect") return;
    window.history.replaceState(null, "", location.path);
    setLocation(readLocation(location.path));
  }, [location]);

  const navigate: Navigate = (path, options) => {
    if (options?.replace === true) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    setLocation(readLocation(path));
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("main, [tabindex='-1']")?.focus();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  };

  async function revokeSessions(path: string) {
    try {
      await api<void>(path, { method: "POST" });
    } catch (reason) {
      if (!(reason instanceof ApiError) || reason.status !== 401) throw reason;
    }
    endSession();
  }

  function logout() {
    return revokeSessions("/api/auth/logout");
  }

  function logoutAll() {
    return revokeSessions("/api/auth/logout-all");
  }

  if (location.type === "home") return <HomeChoice navigate={navigate} />;
  if (location.type === "not-found")
    return <NotFoundPage navigate={navigate} />;
  if (location.type === "redirect") return null;

  if (authenticationStatus === "checking") {
    return <AppLoadingView />;
  }

  if (authenticationStatus === "error" && authenticationError !== null) {
    return (
      <AppFailureView
        error={toErrorNotice(authenticationError)}
        onRetry={() => {
          setAuthenticationStatus("checking");
        }}
      />
    );
  }

  if (authenticationStatus !== "authenticated" || user === null) {
    return (
      <IdentityGate
        notice={authenticationNotice}
        onAuthenticated={establishSession}
      />
    );
  }

  const accountProps = {
    user,
    onLogout: logout,
    onLogoutAll: logoutAll,
    onSessionChanged: establishSession,
  };

  if (location.type === "invite") {
    return (
      <InvitePage
        area={location.area}
        token={location.token}
        navigate={navigate}
        {...accountProps}
      />
    );
  }

  if (location.type === "play-world") {
    return (
      <PlayWorkspace
        worldId={location.worldId}
        navigate={navigate}
        {...accountProps}
      />
    );
  }

  if (location.type === "play-new-world") {
    return <WorldTemplateLibrary navigate={navigate} {...accountProps} />;
  }

  if (location.type === "build-world") {
    return (
      <BuildWorkspace
        worldId={location.worldId}
        section={location.section}
        resourceId={location.resourceId}
        navigate={navigate}
        {...accountProps}
      />
    );
  }

  const libraryProps = { navigate, ...accountProps };
  if (location.type === "play-library")
    return <PlayLibrary {...libraryProps} />;
  return <BuildLibrary {...libraryProps} />;
}
