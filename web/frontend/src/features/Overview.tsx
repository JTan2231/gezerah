import type { CSSProperties } from "react";

import { useCollection } from "../hooks/useCollection";
import { ruleSetPath } from "../api/client";
import type { AppRoute } from "../routes";
import type {
  ConditionSet,
  Entity,
  OwnerSchema,
  ProblemDefinition,
  ProblemInstance,
  StateVariableDefinition,
} from "../api/types";
import { PageHeader, Panel, StatusBadge } from "../components/ui";

export function Overview({
  ruleSetId,
  onNavigate,
}: {
  ruleSetId: string;
  onNavigate: (route: AppRoute) => void;
}) {
  const owners = useCollection<OwnerSchema>(
    ruleSetPath(ruleSetId, "owner-schemas"),
  );
  const variables = useCollection<StateVariableDefinition>(
    ruleSetPath(ruleSetId, "state-variable-definitions"),
  );
  const conditions = useCollection<ConditionSet>(
    ruleSetPath(ruleSetId, "condition-sets"),
  );
  const problems = useCollection<ProblemDefinition>(
    ruleSetPath(ruleSetId, "problem-definitions"),
  );
  const entities = useCollection<Entity>(ruleSetPath(ruleSetId, "entities"));
  const instances = useCollection<ProblemInstance>(
    ruleSetPath(ruleSetId, "problem-instances"),
  );

  const steps: Array<{
    route: AppRoute;
    number: string;
    title: string;
    description: string;
    count: number;
    ready: boolean;
  }> = [
    {
      route: "owner-schemas",
      number: "01",
      title: "Name ownership capabilities",
      description:
        "Describe the capabilities an entity can implement. No built-in entity taxonomy is imposed.",
      count: owners.items.length,
      ready: owners.items.length > 0,
    },
    {
      route: "state-variables",
      number: "02",
      title: "Declare typed state",
      description:
        "Choose ownership, kind, cardinality, missing behavior, controls, and permitted effects.",
      count: variables.items.length,
      ready: variables.items.length > 0,
    },
    {
      route: "entities",
      number: "03",
      title: "Add world entities",
      description:
        "Create durable identities, attach capabilities, then maintain their current state.",
      count: entities.items.length,
      ready: entities.items.length > 0,
    },
    {
      route: "conditions",
      number: "04",
      title: "Compose reusable conditions",
      description:
        "Address declared parameters and explain met, unmet, and unknown evaluations.",
      count: conditions.items.length,
      ready: conditions.items.length > 0,
    },
    {
      route: "problems",
      number: "05",
      title: "Design choices and outcomes",
      description:
        "Map targets explicitly, separate availability from resolution, and order every effect.",
      count: problems.items.length,
      ready: problems.items.length > 0,
    },
    {
      route: "instances",
      number: "06",
      title: "Bind and run an instance",
      description:
        "Supply concrete entities to target slots, preview, then resolve against current state.",
      count: instances.items.length,
      ready: instances.items.length > 0,
    },
  ];
  const complete = steps.filter((step) => step.ready).length;

  return (
    <>
      <PageHeader
        eyebrow="Setup guide"
        title="Build semantics before scenarios."
        description="Work from reusable capabilities toward a concrete transition. Each step remains independently editable."
      />
      <div className="overview-grid">
        <Panel className="progress-panel">
          <div
            className="progress-ring"
            style={
              {
                "--progress": `${(complete / steps.length) * 100}%`,
              } as CSSProperties
            }
          >
            <span>
              {complete}/{steps.length}
            </span>
          </div>
          <div>
            <p className="eyebrow">Configuration readiness</p>
            <h2>
              {complete === steps.length
                ? "Ready to resolve"
                : "Your model is taking shape"}
            </h2>
            <p>
              {complete === 0
                ? "Start by giving state ownership a vocabulary."
                : "The guide tracks presence, while each editor validates the actual semantics."}
            </p>
          </div>
        </Panel>
        <div className="setup-steps">
          {steps.map((step) => (
            <button
              className="setup-step"
              type="button"
              key={step.route}
              onClick={() => onNavigate(step.route)}
            >
              <span className="step-number">{step.number}</span>
              <span className="step-copy">
                <strong>{step.title}</strong>
                <small>{step.description}</small>
              </span>
              <span className="step-state">
                <StatusBadge tone={step.ready ? "good" : "neutral"}>
                  {step.ready ? `${step.count} configured` : "Not started"}
                </StatusBadge>
                <span aria-hidden="true">→</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
