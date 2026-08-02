import { useEffect, useState } from "react";

import { api, ApiError, jsonBody, ruleSetPath } from "../api/client";
import type {
  ChoiceResolutionResult,
  ConditionEvaluationNode,
  Entity,
  ProblemDefinition,
  ProblemInstance,
  StateValue,
} from "../api/types";
import {
  EmptyState,
  ErrorNotice,
  Field,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui";
import { useCollection } from "../hooks/useCollection";

export function Runtime({ ruleSetId }: { ruleSetId: string }) {
  const instances = useCollection<ProblemInstance>(
    ruleSetPath(ruleSetId, "problem-instances"),
  );
  const problems = useCollection<ProblemDefinition>(
    ruleSetPath(ruleSetId, "problem-definitions"),
  );
  const entities = useCollection<Entity>(ruleSetPath(ruleSetId, "entities"));
  const [instanceId, setInstanceId] = useState("");
  const [previews, setPreviews] = useState<
    Record<string, ChoiceResolutionResult>
  >({});
  const [result, setResult] = useState<ChoiceResolutionResult | null>(null);
  const [loadingChoice, setLoadingChoice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const instance = instances.items.find((item) => item.id === instanceId);
  const problem = problems.items.find(
    (item) => item.id === instance?.problem_definition_id,
  );
  useEffect(() => {
    setInstanceId("");
    setPreviews({});
    setResult(null);
    setError(null);
  }, [ruleSetId]);
  useEffect(() => {
    setPreviews({});
    setError(null);
    if (instance === undefined || problem === undefined) return;
    const controller = new AbortController();
    void Promise.all(
      problem.choices.map(async (choice) => {
        const preview = await api<ChoiceResolutionResult>(
          ruleSetPath(
            ruleSetId,
            `problem-instances/${instance.id}/choices/${choice.id}/preview`,
          ),
          {
            method: "POST",
            signal: controller.signal,
            ...jsonBody({
              expected_binding_revision: instance.binding_revision,
            }),
          },
        );
        return [choice.id, preview] as const;
      }),
    )
      .then((entries) => setPreviews(Object.fromEntries(entries)))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof ApiError
              ? reason
              : new ApiError(
                  0,
                  "unknown",
                  "Could not preview current choices.",
                ),
          );
      });
    return () => controller.abort();
  }, [instance, problem, ruleSetId]);
  async function act(choiceId: string, preview: boolean) {
    if (instance === undefined) return;
    setLoadingChoice(choiceId);
    setError(null);
    try {
      const next = await api<ChoiceResolutionResult>(
        ruleSetPath(
          ruleSetId,
          `problem-instances/${instance.id}/choices/${choiceId}/${preview ? "preview" : "resolve"}`,
        ),
        {
          method: "POST",
          ...jsonBody({ expected_binding_revision: instance.binding_revision }),
        },
      );
      setResult(next);
      if (preview) setPreviews({ ...previews, [choiceId]: next });
      else instances.reload();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not resolve this choice."),
      );
    } finally {
      setLoadingChoice(null);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Run / 02"
        title="Runtime"
        description="Open one binding context, inspect authoritative availability, preview advisory changes, then resolve atomically."
      />
      <div className="runtime-layout">
        <Panel title="Open an instance">
          <Field label="Problem instance">
            <select
              value={instanceId}
              onChange={(event) => {
                setInstanceId(event.currentTarget.value);
                setResult(null);
              }}
            >
              <option value="">Choose an instance</option>
              {instances.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.display_name}
                </option>
              ))}
            </select>
          </Field>
          {instance === undefined || problem === undefined ? null : (
            <>
              <div className="badge-row">
                <StatusBadge tone="info">
                  Bindings r{instance.binding_revision}
                </StatusBadge>
                <StatusBadge>State r{instance.state_revision}</StatusBadge>
              </div>
              <h3>Current target bindings</h3>
              {problem.targets.map((target) => {
                const binding = instance.bindings.find(
                  (item) => item.target_definition_id === target.id,
                );
                const boundNames =
                  binding?.entity_ids
                    .map(
                      (id) =>
                        entities.items.find((entity) => entity.id === id)
                          ?.display_name ?? id,
                    )
                    .join(", ") ?? "";
                return (
                  <div className="runtime-binding" key={target.id}>
                    <strong>{target.label}</strong>
                    <span>
                      {target.binding_source === "problem-instance"
                        ? instance.display_name
                        : boundNames === ""
                          ? "No entities"
                          : boundNames}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </Panel>
        <div className="editor-stack">
          {error === null ? null : <ErrorNotice error={error} />}
          {instance === undefined || problem === undefined ? (
            <EmptyState
              title="Choose an instance to run"
              description="The server derives every concrete entity from its current bindings. No actor or outcome is supplied by the client."
            />
          ) : (
            <>
              <Panel
                title={problem.name}
                description={
                  problem.description ?? "Choose an available action."
                }
              >
                {problem.choices.map((choice) => {
                  const preview = previews[choice.id];
                  const status = preview?.status;
                  return (
                    <article className="runtime-choice" key={choice.id}>
                      <div className="runtime-choice-head">
                        <div>
                          <h3>{choice.name}</h3>
                          <p>{choice.description}</p>
                        </div>
                        {status === undefined ? (
                          <StatusBadge>Checking…</StatusBadge>
                        ) : (
                          <StatusBadge
                            tone={
                              status === "applied"
                                ? "good"
                                : status === "incomplete"
                                  ? "warn"
                                  : "bad"
                            }
                          >
                            {status === "applied"
                              ? "Available"
                              : status === "incomplete"
                                ? "Incomplete"
                                : "Unavailable"}
                          </StatusBadge>
                        )}
                      </div>
                      {preview === undefined ? null : (
                        <ChoiceExplanation result={preview} />
                      )}
                      <div className="compact-actions">
                        <button
                          className="button-secondary"
                          type="button"
                          disabled={loadingChoice !== null}
                          onClick={() => void act(choice.id, true)}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          disabled={
                            loadingChoice !== null || status !== "applied"
                          }
                          onClick={() => void act(choice.id, false)}
                        >
                          {loadingChoice === choice.id
                            ? "Working…"
                            : "Resolve choice"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </Panel>
              {result === null ? null : <ResolutionResult result={result} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ChoiceExplanation({ result }: { result: ChoiceResolutionResult }) {
  const evaluations =
    result.status === "applied" || result.status === "unavailable"
      ? result.availability_evaluations
      : result.evaluations;
  return (
    <div className="choice-explanation">
      {evaluations.map((evaluation) => (
        <p key={evaluation.condition_set_id}>{evaluation.root.message}</p>
      ))}
      {result.status === "incomplete" ? (
        <p>
          Required world state is unknown. No outcome or effects are applied.
        </p>
      ) : null}
    </div>
  );
}
function ResolutionResult({ result }: { result: ChoiceResolutionResult }) {
  return (
    <Panel
      className="resolution-result"
      title={
        result.preview === true
          ? "Advisory preview"
          : result.status === "applied"
            ? "Transition applied"
            : result.status === "incomplete"
              ? "Resolution incomplete"
              : "Choice unavailable"
      }
      actions={
        <StatusBadge
          tone={
            result.status === "applied"
              ? "good"
              : result.status === "incomplete"
                ? "warn"
                : "bad"
          }
        >
          {result.status}
        </StatusBadge>
      }
    >
      {result.preview === true ? (
        <div className="notice notice-warn">
          <strong>Preview only</strong>
          <p>
            Current configuration, bindings, or state may change before
            resolution.
          </p>
        </div>
      ) : null}
      {result.status === "applied" ? (
        <>
          <p>
            Outcome <code>{result.outcome_id}</code> was selected. Concrete
            effects are shown in authored order.
          </p>
          <div className="effect-results">
            {result.applied_effects.map((effect, index) => (
              <div
                className="effect-result"
                key={`${effect.effect_id}-${effect.entity_id}-${index}`}
              >
                <span className="effect-index">{index + 1}</span>
                <div>
                  <strong>{effect.changed ? "State changed" : "No-op"}</strong>
                  <p>
                    {effect.entity_id} · {effect.state_variable_id}
                  </p>
                  <div className="before-after">
                    <ValueSnapshot label="Before" value={effect.before} />
                    <span aria-hidden="true">→</span>
                    <ValueSnapshot label="After" value={effect.after} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {result.applied_effects.length === 0 ? (
            <p className="quiet-empty">
              This outcome has an explicit empty consequence set.
            </p>
          ) : null}
          {result.resolution_evaluation === undefined ? null : (
            <EvaluationTree node={result.resolution_evaluation.root} />
          )}
        </>
      ) : (
        <ChoiceExplanation result={result} />
      )}
    </Panel>
  );
}
function ValueSnapshot({
  label,
  value,
}: {
  label: string;
  value: StateValue | undefined;
}) {
  return (
    <span>
      <small>{label}</small>
      <code>{value === undefined ? "unknown" : JSON.stringify(value)}</code>
    </span>
  );
}
function EvaluationTree({ node }: { node: ConditionEvaluationNode }) {
  return (
    <div className="evaluation-tree">
      <div>
        <StatusBadge
          tone={
            node.status === "met"
              ? "good"
              : node.status === "unknown"
                ? "warn"
                : "bad"
          }
        >
          {node.status}
        </StatusBadge>
        <span>{node.message}</span>
      </div>
      {node.children?.map((child) => (
        <EvaluationTree key={child.expression_id} node={child} />
      ))}
    </div>
  );
}
