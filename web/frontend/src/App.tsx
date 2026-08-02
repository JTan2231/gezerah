import { useEffect, useState } from "react";

import { readSelectedUserId, selectUserId } from "./api/client";
import type { User } from "./api/types";
import { Brand, ErrorMessage, LoadingState } from "./components/StudioUI";
import { IdentityGate } from "./features/IdentityGate";
import { InvitePage } from "./features/InvitePage";
import { WorldLibrary } from "./features/WorldLibrary";
import { WorldWorkspace } from "./features/WorldWorkspace";
import { useCollection } from "./hooks/useCollection";
import { readLocation } from "./worldRoutes";

export default function App() {
  const [selectedUserId, setSelectedUserId] = useState(readSelectedUserId);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [location, setLocation] = useState(readLocation);
  const users = useCollection<User>(
    selectedUserId === "" ? null : "/api/users",
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

  function navigate(path: string) {
    window.history.pushState(null, "", path);
    setLocation(readLocation(path));
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("main, [tabindex='-1']")?.focus();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  }

  function chooseUser(nextUser: User) {
    selectUserId(nextUser.id);
    setSelectedUserId(nextUser.id);
    setSelectedUser(nextUser);
  }

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
      <InvitePage token={location.token} user={user} navigate={navigate} />
    );
  }

  if (location.type === "world") {
    return (
      <WorldWorkspace
        worldId={location.worldId}
        section={location.section}
        resourceId={location.resourceId}
        user={user}
        navigate={navigate}
      />
    );
  }

  return (
    <WorldLibrary
      user={user}
      navigate={navigate}
      onSwitchProfile={() => {
        setSelectedUserId("");
        setSelectedUser(null);
      }}
    />
  );
}
