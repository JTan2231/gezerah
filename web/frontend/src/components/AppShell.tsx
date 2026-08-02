import type { ReactNode } from "react";

import type { RuleSet } from "../api/types";
import type { AppRoute } from "../routes";
import { routeLabels } from "../routes";

const navGroups: Array<{ label: string; routes: AppRoute[] }> = [
  { label: "Start", routes: ["overview"] },
  {
    label: "Define",
    routes: ["owner-schemas", "state-variables", "conditions", "problems"],
  },
  { label: "World", routes: ["entities", "state"] },
  { label: "Run", routes: ["instances", "runtime"] },
];

export function AppShell({
  rulesets,
  ruleSet,
  route,
  onRuleSetChange,
  onCreateRuleSet,
  onEditRuleSet,
  onNavigate,
  children,
}: {
  rulesets: RuleSet[];
  ruleSet: RuleSet;
  route: AppRoute;
  onRuleSetChange: (id: string) => void;
  onCreateRuleSet: () => void;
  onEditRuleSet: () => void;
  onNavigate: (route: AppRoute) => void;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span>
            <strong>Rule Composer</strong>
            <small>State transition studio</small>
          </span>
        </div>
        <label className="ruleset-switcher">
          <span>Ruleset</span>
          <select
            value={ruleSet.id}
            onChange={(event) => onRuleSetChange(event.currentTarget.value)}
          >
            {rulesets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="sidebar-create"
          type="button"
          onClick={onCreateRuleSet}
        >
          + New ruleset
        </button>
        <button
          className="sidebar-create sidebar-edit"
          type="button"
          onClick={onEditRuleSet}
        >
          Edit ruleset details
        </button>
        <nav aria-label="Rule composer">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.routes.map((item) => (
                <button
                  className={route === item ? "nav-active" : ""}
                  type="button"
                  key={item}
                  aria-current={route === item ? "page" : undefined}
                  onClick={() => onNavigate(item)}
                >
                  <span className="nav-dot" aria-hidden="true" />
                  {routeLabels[item]}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="connection-dot" aria-hidden="true" />
          Current configuration
        </div>
      </aside>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
