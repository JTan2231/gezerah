import { useEffect, useState } from "react";

import { readSelectedUserId, selectUserId } from "./api/client";
import type { User } from "./api/types";
import { Brand, ErrorMessage, LoadingState } from "./components/StudioUI";
import { HomeChoice } from "./features/HomeChoice";
import { IdentityGate } from "./features/IdentityGate";
import { InvitePage } from "./features/InvitePage";
import { NotFoundPage } from "./features/NotFoundPage";
import { PlayLibrary } from "./features/PlayLibrary";
import { PlayWorkspace } from "./features/PlayWorkspace";
import { BuildLibrary } from "./features/BuildLibrary";
import { BuildWorkspace } from "./features/BuildWorkspace";
import { useCollection } from "./hooks/useCollection";
import { readLocation, type Navigate } from "./worldRoutes";

export default function App() {
  const [selectedUserId, setSelectedUserId] = useState(readSelectedUserId);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [location, setLocation] = useState(readLocation);
  const identityRequired =
    location.type !== "home" &&
    location.type !== "redirect" &&
    location.type !== "not-found";
  const users = useCollection<User>(
    selectedUserId === "" || !identityRequired ? null : "/api/users",
  );
  const user =
    selectedUser?.id === selectedUserId
      ? selectedUser
      : users.items.find((candidate) => candidate.id === selectedUserId);

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

  function chooseUser(nextUser: User) {
    selectUserId(nextUser.id);
    setSelectedUserId(nextUser.id);
    setSelectedUser(nextUser);
  }

  if (location.type === "home") return <HomeChoice navigate={navigate} />;
  if (location.type === "not-found")
    return <NotFoundPage navigate={navigate} />;
  if (location.type === "redirect") return null;

  if (selectedUserId !== "" && users.loading && user === undefined) {
    return (
      <main className="app-boot">
        <Brand />
        <LoadingState label="Opening your worlds" />
      </main>
    );
  }

  if (selectedUserId !== "" && users.error !== null && user === undefined) {
    return (
      <main className="app-boot">
        <Brand />
        <ErrorMessage error={users.error} onRetry={users.reload} />
        <button
          className="button button-quiet"
          type="button"
          onClick={() => {
            selectUserId("");
            setSelectedUserId("");
          }}
        >
          Choose another local profile
        </button>
      </main>
    );
  }

  if (user === undefined) return <IdentityGate onSelected={chooseUser} />;

  if (location.type === "invite") {
    return (
      <InvitePage
        area={location.area}
        token={location.token}
        user={user}
        navigate={navigate}
      />
    );
  }

  if (location.type === "play-world") {
    return (
      <PlayWorkspace
        worldId={location.worldId}
        user={user}
        navigate={navigate}
        onSwitchProfile={() => {
          setSelectedUserId("");
          setSelectedUser(null);
        }}
      />
    );
  }

  if (location.type === "build-world") {
    return (
      <BuildWorkspace
        worldId={location.worldId}
        section={location.section}
        resourceId={location.resourceId}
        user={user}
        navigate={navigate}
      />
    );
  }

  const libraryProps = {
    user,
    navigate,
    onSwitchProfile: () => {
      setSelectedUserId("");
      setSelectedUser(null);
    },
  };
  if (location.type === "play-library")
    return <PlayLibrary {...libraryProps} />;
  return <BuildLibrary {...libraryProps} />;
}
