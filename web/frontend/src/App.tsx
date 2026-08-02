import { useEffect, useState } from "react";

import { AppShell } from "./components/AppShell";
import { EmptyState, ErrorNotice, LoadingRows } from "./components/ui";
import { Overview } from "./features/Overview";
import { OwnerSchemas } from "./features/OwnerSchemas";
import { StateVariables } from "./features/StateVariables";
import { Conditions } from "./features/Conditions";
import { Problems } from "./features/Problems";
import { Entities } from "./features/Entities";
import { StateInspector } from "./features/StateInspector";
import { Instances } from "./features/Instances";
import { Runtime } from "./features/Runtime";
import { RuleSetOnboarding } from "./features/RuleSetOnboarding";
import { RuleSetEditor } from "./features/RuleSetEditor";
import { Play } from "./features/Play";
import type { RuleSet } from "./api/types";
import type { AppRoute } from "./routes";
import { readRoute } from "./routes";
import { useCollection } from "./hooks/useCollection";
import { confirmDiscardDraft } from "./hooks/useDraft";

const selectedRuleSetKey = "dnd.selected-rule-set";

export default function App() {
  const rulesets = useCollection<RuleSet>("/api/rule-sets");
  const [selectedId, setSelectedId] = useState(
    () => localStorage.getItem(selectedRuleSetKey) ?? "",
  );
  const [route, setRoute] = useState<AppRoute>(() => readRoute());
  const [creating, setCreating] = useState(false);
  const [editingRuleSet, setEditingRuleSet] = useState(false);
  const selected =
    rulesets.items.find((item) => item.id === selectedId) ?? rulesets.items[0];

  useEffect(() => {
    if (selected === undefined) return;
    setSelectedId(selected.id);
    localStorage.setItem(selectedRuleSetKey, selected.id);
  }, [selected]);
  useEffect(() => {
    const handlePop = () => setRoute(readRoute());
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  function navigate(next: AppRoute) {
    if (!confirmDiscardDraft()) return;
    const path = `/app/${next}`;
    window.history.pushState(null, "", path);
    setRoute(next);
    document.querySelector<HTMLElement>("#main-content")?.focus();
  }
  function created(ruleSet: RuleSet) {
    rulesets.replaceItem(ruleSet, (item) => item.id);
    setSelectedId(ruleSet.id);
    localStorage.setItem(selectedRuleSetKey, ruleSet.id);
    setCreating(false);
  }

  if (rulesets.loading)
    return (
      <main className="boot-screen">
        <div className="brand boot-brand">
          <span className="brand-mark">R</span>
          <strong>Rule Composer</strong>
        </div>
        <LoadingRows />
      </main>
    );
  if (rulesets.error !== null)
    return (
      <main className="boot-screen">
        <ErrorNotice error={rulesets.error} onRetry={rulesets.reload} />
        <EmptyState
          title="Your drafts stay local"
          description="Reconnect to load authoritative rulesets from the server."
        />
      </main>
    );
  if (selected === undefined) return <RuleSetOnboarding onCreated={created} />;

  return (
    <AppShell
      rulesets={rulesets.items}
      ruleSet={selected}
      route={route}
      onRuleSetChange={(id) => {
        if (!confirmDiscardDraft()) return;
        setSelectedId(id);
        localStorage.setItem(selectedRuleSetKey, id);
      }}
      onCreateRuleSet={() => setCreating(true)}
      onEditRuleSet={() => setEditingRuleSet(true)}
      onNavigate={navigate}
    >
      {route === "overview" ? (
        <Overview ruleSetId={selected.id} onNavigate={navigate} />
      ) : null}
      {route === "owner-schemas" ? (
        <OwnerSchemas ruleSetId={selected.id} />
      ) : null}
      {route === "state-variables" ? (
        <StateVariables ruleSetId={selected.id} />
      ) : null}
      {route === "conditions" ? <Conditions ruleSetId={selected.id} /> : null}
      {route === "problems" ? <Problems ruleSetId={selected.id} /> : null}
      {route === "entities" ? <Entities ruleSetId={selected.id} /> : null}
      {route === "state" ? <StateInspector ruleSetId={selected.id} /> : null}
      {route === "instances" ? <Instances ruleSetId={selected.id} /> : null}
      {route === "runtime" ? <Runtime ruleSetId={selected.id} /> : null}
      {route === "play" ? <Play ruleSetId={selected.id} /> : null}
      {creating ? (
        <RuleSetOnboarding
          compact
          onCreated={created}
          onCancel={() => setCreating(false)}
        />
      ) : null}
      {editingRuleSet ? (
        <RuleSetEditor
          source={selected}
          onSaved={(saved) => {
            rulesets.replaceItem(saved, (item) => item.id);
            setEditingRuleSet(false);
          }}
          onCancel={() => setEditingRuleSet(false)}
        />
      ) : null}
    </AppShell>
  );
}
