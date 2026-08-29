import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  ApiError,
  jsonBody,
  toErrorNotice,
  worldPath,
} from "../api/client";
import type {
  AvailableCharacters,
  CharacterClaimResult,
  ConsequenceCompilation,
  Interaction,
  InteractionAction,
  InteractionResolutionResult,
  StateValue,
  User,
  World,
  WorldEntity,
  WorldMechanic,
  WorldMechanicCollection,
  WorldMember,
} from "../api/types";
import { formatRelativeDate, humanize } from "../domain/display";
import { useCollection } from "../hooks/useCollection";
import { useResource } from "../hooks/useResource";
import { useWorldEvents, type WorldEvent } from "../hooks/useWorldEvents";
import { playWorldURL } from "../worldRoutes";
import { EntityDetail } from "./EntityDetail";
import { EntityProfilePanel } from "./EntityProfilePanel";
import {
  buildAgentLaunchURL,
  buildAgentStarterPrompt,
  siteToolsSupported,
  useAgentPlayTools,
} from "./agentPlayTools";
import {
  CharacterOnboardingView,
  LiveInteractionView,
  WorldPlayBoundaryView,
  WorldPlayView,
} from "./WorldPlayView";
import type {
  AgentModeViewModel,
  HistoryCardViewModel,
  PlayViewIssue,
  RulingPreviewViewModel,
  SubmittedActionViewModel,
} from "./WorldPlayViewModel";
import {
  AgentDecisionPendingView,
  NewProblemView,
  OpenProblemView,
  TerraDecisionPendingView,
} from "./WorldProblemView";
import { RulingView } from "./WorldRulingView";

export function WorldPlay({
  world,
  user,
  onWorldChanged,
}: {
  world: World;
  user: User;
  onWorldChanged: () => void;
}) {
  const playReady =
    world.status === "archived" ||
    world.current_play_role !== "player" ||
    world.play_status === "ready";
  const members = useCollection<WorldMember>(worldPath(world.id, "members"));
  const entities = useCollection<WorldEntity>(worldPath(world.id, "entities"));
  const mechanics = useResource<WorldMechanicCollection>(
    playReady ? worldPath(world.id, "mechanics") : null,
  );
  const interactions = useCollection<Interaction>(
    playReady ? worldPath(world.id, "interactions") : null,
  );
  const availableCharacters = useResource<AvailableCharacters>(
    world.status === "active" &&
      world.facilitator.source === "agent" &&
      world.current_play_role === "player" &&
      world.play_status === "waiting-for-character"
      ? worldPath(world.id, "available-characters")
      : null,
  );
  const [creatingProblem, setCreatingProblem] = useState(false);
  const [changingFacilitator, setChangingFacilitator] = useState(false);
  const [facilitatorError, setFacilitatorError] = useState<ApiError | null>(
    null,
  );
  const [continuingWithTerra, setContinuingWithTerra] = useState(false);
  const [terraContinueError, setTerraContinueError] = useState<ApiError | null>(
    null,
  );
  const [profileRefreshToken, setProfileRefreshToken] = useState(0);
  const [agentPromptCopied, setAgentPromptCopied] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<
    string | undefined
  >();
  const agentStarterPrompt = buildAgentStarterPrompt(
    new URL(playWorldURL(world.id), window.location.origin).href,
  );
  const agentLaunchURL = buildAgentLaunchURL(
    new URL(playWorldURL(world.id), window.location.origin).href,
    agentStarterPrompt,
  );
  const reloadMembers = members.reload;
  const reloadEntities = entities.reload;
  const reloadInteractions = interactions.reload;
  const reloadAvailableCharacters = availableCharacters.reload;

  const reloadMechanics = mechanics.reload;
  const refresh = useCallback(
    (event?: WorldEvent) => {
      reloadMembers();
      reloadEntities();
      reloadInteractions();
      reloadAvailableCharacters();
      if (event === undefined || event.type === "rules-updated") {
        reloadMechanics();
      }
      onWorldChanged();
      setProfileRefreshToken((value) => value + 1);
    },
    [
      onWorldChanged,
      reloadEntities,
      reloadInteractions,
      reloadMechanics,
      reloadMembers,
      reloadAvailableCharacters,
    ],
  );
  useAgentPlayTools({
    enabled: world.status === "active" && world.facilitator.source === "agent",
    worldId: world.id,
    onChanged: refresh,
  });
  useWorldEvents(playReady ? world.id : undefined, refresh);

  function copyAgentPrompt() {
    void navigator.clipboard
      .writeText(agentStarterPrompt)
      .then(() => setAgentPromptCopied(true))
      .catch(() => setAgentPromptCopied(false));
  }

  async function changeFacilitator(value: string) {
    const currentValue =
      world.facilitator.source !== "human"
        ? world.facilitator.source
        : `human:${world.facilitator.membership_id ?? ""}`;
    if (value === currentValue) return;
    const terra = value === "terra";
    const agent = value === "agent";
    const automated = terra || agent;
    const membershipID = automated ? undefined : value.replace(/^human:/, "");
    const currentMember = members.items.find(
      (item) => item.id === world.membership_id,
    );
    const targetMember = members.items.find((item) => item.id === membershipID);
    const emergencyTakeover =
      !automated &&
      world.facilitator.source !== "human" &&
      membershipID === world.membership_id &&
      interactions.items.some((item) => item.status === "adjudicating");
    const possibleAutomatedTakeover =
      !automated &&
      world.facilitator.source !== "human" &&
      membershipID === world.membership_id &&
      world.role === "owner";
    const returningToSeat =
      world.current_play_role === "facilitator"
        ? currentMember?.play_status === "ready"
          ? " Your player seat is ready when the handoff completes."
          : " You’ll enter character setup when the handoff completes."
        : "";
    const confirmation =
      emergencyTakeover || possibleAutomatedTakeover
        ? `Take over from ${world.facilitator.source === "agent" ? "ChatGPT" : "Terra"}? If a problem is active, your submitted action will be withdrawn and you will decide the outcome as Dungeon Master.`
        : terra
          ? `Hand the table to Terra Auto DM? Terra will author and resolve the next problem.${returningToSeat}`
          : agent
            ? `Hand the table to ChatGPT? ChatGPT will use this signed-in Play page to author and resolve problems.${returningToSeat}`
            : `${targetMember?.display_name ?? "This member"} will become the Dungeon Master and their player seat will pause.${returningToSeat}`;
    if (!window.confirm(confirmation)) return;
    setChangingFacilitator(true);
    setFacilitatorError(null);
    try {
      await api<World>(worldPath(world.id, "facilitator"), {
        method: "PUT",
        ...jsonBody({
          source: terra ? "terra" : agent ? "agent" : "human",
          ...(membershipID === undefined
            ? {}
            : { membership_id: membershipID }),
          expected_revision: world.revision,
        }),
      });
      setCreatingProblem(false);
      refresh();
    } catch (reason) {
      setFacilitatorError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not hand off the table."),
      );
    } finally {
      setChangingFacilitator(false);
    }
  }

  async function continueWithTerra() {
    setContinuingWithTerra(true);
    setTerraContinueError(null);
    try {
      await api<Interaction>(worldPath(world.id, "auto-dm/continue"), {
        method: "POST",
      });
      refresh();
    } catch (reason) {
      setTerraContinueError(
        reason instanceof ApiError
          ? reason
          : new ApiError(
              0,
              "unknown",
              "Terra could not prepare the next problem.",
            ),
      );
    } finally {
      setContinuingWithTerra(false);
    }
  }

  useEffect(() => {
    const mechanicsRevision = mechanics.value?.revision;
    if (
      !playReady ||
      mechanicsRevision === undefined ||
      mechanics.loading ||
      entities.loading
    )
      return;
    const mismatched = entities.items.some(
      (entity) => entity.state.rules_revision !== mechanicsRevision,
    );
    if (!mismatched) return;
    reloadMechanics();
    reloadEntities();
  }, [
    entities.items,
    entities.loading,
    mechanics.loading,
    mechanics.value?.revision,
    playReady,
    reloadEntities,
    reloadMechanics,
  ]);

  useEffect(() => {
    if (playReady) return undefined;
    const timer = window.setInterval(() => {
      reloadMembers();
      reloadEntities();
      onWorldChanged();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [onWorldChanged, playReady, reloadEntities, reloadMembers]);

  if (!playReady)
    return (
      <CharacterOnboarding
        world={world}
        user={user}
        entities={entities.items}
        controlledEntityIDs={
          members.items.find((item) => item.id === world.membership_id)
            ?.controlled_entity_ids ?? []
        }
        loading={entities.loading || members.loading}
        error={entities.error ?? members.error}
        availableCharacters={availableCharacters.value}
        availableCharactersLoading={availableCharacters.loading}
        availableCharactersError={availableCharacters.error}
        onRetry={() => {
          entities.reload();
          members.reload();
          availableCharacters.reload();
        }}
        refreshToken={profileRefreshToken}
        dungeonMasterName={
          world.facilitator.display_name ??
          (world.facilitator.source === "terra"
            ? "Terra Auto DM"
            : world.facilitator.source === "agent"
              ? "ChatGPT"
              : "Human facilitator")
        }
        canBecomeFacilitator={
          world.status === "active" &&
          (world.role === "owner" || world.role === "editor")
        }
        changingFacilitator={changingFacilitator}
        facilitatorError={facilitatorError}
        onBecomeFacilitator={() =>
          void changeFacilitator(`human:${world.membership_id}`)
        }
        agentMode={
          world.facilitator.source === "agent"
            ? {
                siteToolsAvailable: siteToolsSupported(),
                starterPrompt: agentStarterPrompt,
                launchURL: agentLaunchURL,
                promptCopied: agentPromptCopied,
              }
            : null
        }
        onCopyAgentPrompt={copyAgentPrompt}
        onChanged={refresh}
      />
    );

  if (
    (members.loading && members.items.length === 0) ||
    (mechanics.loading && mechanics.value === null)
  )
    return (
      <WorldPlayBoundaryView
        model={{ kind: "loading", label: "Loading world" }}
      />
    );
  const loadIssue = toPlayViewIssue(members.error ?? mechanics.error);
  if (loadIssue !== null)
    return (
      <WorldPlayBoundaryView
        model={{ kind: "issue", issue: loadIssue }}
        onRetry={() => refresh()}
      />
    );

  const mechanicItems = mechanics.value?.mechanics ?? [];
  const rulesRevision = mechanics.value?.revision ?? world.rules_revision;
  const rulesReady =
    !mechanics.loading &&
    !entities.loading &&
    entities.error === null &&
    entities.items.every(
      (entity) => entity.state.rules_revision === rulesRevision,
    );

  const membership = members.items.find(
    (item) => item.id === world.membership_id && item.status === "active",
  );
  if (membership === undefined)
    return (
      <WorldPlayBoundaryView
        model={{
          kind: "empty",
          title: "Play access unavailable",
          description: "An active world membership is required to enter play.",
        }}
      />
    );
  const facilitator = world.current_play_role === "facilitator";
  const controlledEntityIDs = membership.controlled_entity_ids;
  const active = interactions.items.find(
    (item) =>
      item.status === "open" ||
      item.status === "adjudicating" ||
      item.status === "draft",
  );
  const history = interactions.items.filter(
    (item) => item.status === "resolved" || item.status === "cancelled",
  );
  const firstControlledEntity = controlledEntityIDs
    .map((id) => entities.items.find((entity) => entity.id === id))
    .find((entity) => entity !== undefined && !entity.archived);
  const selectedEntity =
    entities.items.find((item) => item.id === selectedEntityId) ??
    firstControlledEntity ??
    entities.items[0];
  const facilitatorName =
    world.facilitator.display_name ??
    (world.facilitator.source === "terra"
      ? "Terra Auto DM"
      : world.facilitator.source === "agent"
        ? "ChatGPT"
        : (members.items.find(
            (item) => item.id === world.facilitator.membership_id,
          )?.display_name ?? "Facilitator"));
  const facilitatorValue =
    world.facilitator.source !== "human"
      ? world.facilitator.source
      : `human:${world.facilitator.membership_id ?? ""}`;
  const canChangeFacilitator =
    world.status === "active" &&
    active === undefined &&
    (world.role === "owner" || world.role === "editor" || facilitator);
  const canTakeOverFacilitation =
    world.status === "active" &&
    world.role === "owner" &&
    world.facilitator.source !== "human" &&
    (active?.status === "open" || active?.status === "adjudicating");
  const facilitatorChoices = [
    ...(world.facilitator.source !== "agent"
      ? [{ value: "terra", name: "Terra Auto DM" }]
      : []),
    { value: "agent", name: "ChatGPT" },
    ...members.items
      .filter((item) => item.status === "active" && item.role !== "spectator")
      .map((item) => ({
        value: `human:${item.id}`,
        name:
          item.id === membership.id
            ? `${item.display_name} (you)`
            : item.display_name,
      })),
  ];

  return (
    <WorldPlayView
      model={{
        worldName: world.name,
        currentUserName: user.display_name,
        roleLabel: humanize(world.current_play_role),
        accessLabel: humanize(world.role),
        facilitator,
        canCreateProblem: facilitator && world.status === "active",
        hasActiveProblem: active !== undefined,
        dungeonMaster: {
          name: facilitatorName,
          source: world.facilitator.source,
          selectedValue: facilitatorValue,
          canChange: canChangeFacilitator,
          canTakeOver: canTakeOverFacilitation,
          changing: changingFacilitator,
          choices: facilitatorChoices,
          issue: toPlayViewIssue(facilitatorError),
        },
        idle: {
          terraFacilitated: world.facilitator.source === "terra",
          agentFacilitated: world.facilitator.source === "agent",
          canContinue:
            world.status === "active" &&
            world.current_play_role === "player" &&
            world.play_status === "ready",
          continuing: continuingWithTerra,
          issue: toPlayViewIssue(terraContinueError),
        },
        roster: {
          loading: entities.loading,
          showEmpty: !entities.loading && entities.items.length === 0,
          issue: toPlayViewIssue(entities.error),
          entities: entities.items
            .filter((entity) => !entity.archived)
            .map((entity) => ({
              id: entity.id,
              name: entity.display_name,
              subtitle: entitySubtitle(
                entity,
                mechanicItems,
                members.items,
                membership.id,
              ),
              selected: selectedEntity?.id === entity.id,
              controlled: controlledEntityIDs.includes(entity.id),
              setupRequired: entity.character_status === "setup-required",
            })),
          readyMembers: members.items
            .filter(
              (item) =>
                item.status === "active" && item.play_status === "ready",
            )
            .map((item) => ({ id: item.id, name: item.display_name })),
        },
        problems: {
          loading: interactions.loading && interactions.items.length === 0,
          issue: toPlayViewIssue(interactions.error),
        },
        history: history.map((interaction) =>
          toHistoryCardViewModel(
            interaction,
            entities.items,
            mechanicItems,
            members.items,
          ),
        ),
        agentMode:
          world.facilitator.source === "agent"
            ? {
                siteToolsAvailable: siteToolsSupported(),
                starterPrompt: agentStarterPrompt,
                launchURL: agentLaunchURL,
                promptCopied: agentPromptCopied,
              }
            : null,
      }}
      actions={{
        createProblem: () => setCreatingProblem(true),
        changeFacilitator: (value) => void changeFacilitator(value),
        takeOverFacilitation: () =>
          void changeFacilitator(`human:${world.membership_id}`),
        continueWithTerra: () => void continueWithTerra(),
        copyAgentPrompt,
        retryRoster: entities.reload,
        retryProblems: interactions.reload,
        selectEntity: setSelectedEntityId,
      }}
      slots={{
        activeProblem:
          active === undefined ? null : (
            <LiveInteraction
              interaction={active}
              world={world}
              membership={membership}
              entities={entities.items}
              mechanics={mechanicItems}
              rulesRevision={rulesRevision}
              rulesReady={rulesReady}
              facilitator={facilitator}
              onChanged={refresh}
            />
          ),
        selectedEntity:
          selectedEntity === undefined ? null : (
            <EntityDetail
              key={`${selectedEntity.id}:${selectedEntity.state.revision}:${selectedEntity.state.status_revision}:${selectedEntity.state.rules_revision}:${mechanicItems.map((mechanic) => `${mechanic.id}:${mechanic.updated_at}`).join(":")}`}
              entity={selectedEntity}
              mechanics={mechanicItems}
              rulesRevision={rulesRevision}
              mechanicsEditable={false}
              controlledByCurrentMember={controlledEntityIDs.includes(
                selectedEntity.id,
              )}
              facilitator={false}
              world={world}
              profileRefreshToken={profileRefreshToken}
              onManageControllers={() => undefined}
              onProfileChanged={refresh}
              onSaved={entities.reload}
            />
          ),
        problemDialog: creatingProblem ? (
          <NewProblemController
            world={world}
            members={members.items}
            entities={entities.items}
            onClose={() => setCreatingProblem(false)}
            onCreated={() => {
              setCreatingProblem(false);
              refresh();
            }}
          />
        ) : null,
      }}
    />
  );
}

function CharacterOnboarding({
  world,
  user,
  entities,
  controlledEntityIDs,
  loading,
  error,
  availableCharacters,
  availableCharactersLoading,
  availableCharactersError,
  onRetry,
  refreshToken,
  dungeonMasterName,
  canBecomeFacilitator,
  changingFacilitator,
  facilitatorError,
  onBecomeFacilitator,
  agentMode,
  onCopyAgentPrompt,
  onChanged,
}: {
  world: World;
  user: User;
  entities: WorldEntity[];
  controlledEntityIDs: string[];
  loading: boolean;
  error: ApiError | null;
  availableCharacters: AvailableCharacters | null;
  availableCharactersLoading: boolean;
  availableCharactersError: ApiError | null;
  onRetry: () => void;
  refreshToken: number;
  dungeonMasterName: string;
  canBecomeFacilitator: boolean;
  changingFacilitator: boolean;
  facilitatorError: ApiError | null;
  onBecomeFacilitator: () => void;
  agentMode: AgentModeViewModel | null;
  onCopyAgentPrompt: () => void;
  onChanged: () => void;
}) {
  const available = entities.filter(
    (entity) => !entity.archived && controlledEntityIDs.includes(entity.id),
  );
  const [selectedID, setSelectedID] = useState<string | undefined>();
  const [claimingCharacterID, setClaimingCharacterID] = useState<
    string | undefined
  >();
  const [claimError, setClaimError] = useState<ApiError | null>(null);
  const selected =
    available.find((entity) => entity.id === selectedID) ?? available[0];

  async function claimCharacter(entityID: string) {
    if (availableCharacters === null) return;
    setClaimingCharacterID(entityID);
    setClaimError(null);
    try {
      await api<CharacterClaimResult>(
        worldPath(world.id, `entities/${entityID}/claim`),
        {
          method: "POST",
          ...jsonBody({
            expected_table_revision: availableCharacters.table_revision,
          }),
        },
      );
      onChanged();
    } catch (reason) {
      setClaimError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not claim that character."),
      );
    } finally {
      setClaimingCharacterID(undefined);
    }
  }

  return (
    <CharacterOnboardingView
      model={{
        worldName: world.name,
        currentUserName: user.display_name,
        dungeonMasterName,
        statusLabel:
          world.play_status === "waiting-for-character"
            ? "Waiting for a character"
            : "Setup required",
        facilitatorActionLabel:
          world.facilitator.source === "terra"
            ? "Take over from Terra"
            : world.facilitator.source === "agent"
              ? "Take over from ChatGPT"
              : "Become Dungeon Master",
        canBecomeFacilitator,
        changingFacilitator,
        facilitatorIssue: toPlayViewIssue(facilitatorError),
        loading: loading || availableCharactersLoading,
        issue: toPlayViewIssue(error ?? availableCharactersError),
        characters: available.map((entity) => ({
          id: entity.id,
          name: entity.display_name,
          completedFieldCount: entity.completed_field_count,
          requiredFieldCount: entity.required_field_count,
          selected: selected?.id === entity.id,
        })),
        claimableCharacters: (availableCharacters?.characters ?? []).map(
          (character) => ({
            id: character.id,
            name: character.display_name,
            ...(character.profile_summary === undefined
              ? {}
              : { summary: character.profile_summary }),
          }),
        ),
        claimingCharacterId: claimingCharacterID,
        claimIssue: toPlayViewIssue(claimError),
        agentMode,
      }}
      actions={{
        retry: onRetry,
        selectCharacter: setSelectedID,
        becomeFacilitator: onBecomeFacilitator,
        claimCharacter: (entityID) => void claimCharacter(entityID),
        copyAgentPrompt: onCopyAgentPrompt,
      }}
      profile={
        selected === undefined ? null : (
          <EntityProfilePanel
            world={world}
            entity={selected}
            refreshToken={refreshToken}
            onChanged={onChanged}
          />
        )
      }
    />
  );
}

function NewProblemController({
  world,
  members,
  entities,
  onClose,
  onCreated,
}: {
  world: World;
  members: WorldMember[];
  entities: WorldEntity[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const activeMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          member.status === "active" && member.play_status === "ready",
      ),
    [members],
  );
  const responders = useMemo(
    () =>
      activeMembers.filter((member) => member.current_play_role === "player"),
    [activeMembers],
  );
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [responderIds, setResponderIds] = useState(
    responders.map((member) => member.id),
  );
  const previousResponderIds = useRef(
    new Set(responders.map((member) => member.id)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const available = new Set(responders.map((member) => member.id));
    setResponderIds((current) => [
      ...current.filter((id) => available.has(id)),
      ...responders
        .map((member) => member.id)
        .filter((id) => !previousResponderIds.current.has(id)),
    ]);
    previousResponderIds.current = available;
  }, [responders]);

  function toggle(
    values: string[],
    id: string,
    onChange: (values: string[]) => void,
  ) {
    onChange(
      values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api<Interaction>(worldPath(world.id, "interactions"), {
        method: "POST",
        ...jsonBody({
          id: crypto.randomUUID(),
          present: true,
          title: title.trim() || undefined,
          prompt: prompt.trim(),
          audience_membership_ids: activeMembers.map((member) => member.id),
          eligible_responder_membership_ids: responderIds,
          entity_ids: entityIds,
        }),
      });
      onCreated();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create this problem."),
      );
      setSaving(false);
    }
  }

  return (
    <NewProblemView
      model={{
        draft: {
          title,
          description: prompt,
          selectedEntityIds: entityIds,
          selectedResponderIds: responderIds,
        },
        contextEntities: entities
          .filter(
            (entity) =>
              !entity.archived && entity.character_status !== "setup-required",
          )
          .map((entity) => ({ id: entity.id, name: entity.display_name })),
        showContextChoices: entities.length > 0,
        responders: responders.map((member) => ({
          id: member.id,
          name: member.display_name,
        })),
        saving,
        issue: toPlayViewIssue(error, { prompt: "description" }),
      }}
      actions={{
        changeTitle: setTitle,
        changeDescription: setPrompt,
        toggleContextEntity: (id) => toggle(entityIds, id, setEntityIds),
        toggleResponder: (id) => toggle(responderIds, id, setResponderIds),
        submit: () => void submit(),
        close: onClose,
      }}
    />
  );
}

function LiveInteraction({
  interaction,
  world,
  membership,
  entities,
  mechanics,
  rulesRevision,
  rulesReady,
  facilitator,
  onChanged,
}: {
  interaction: Interaction;
  world: World;
  membership: WorldMember;
  entities: WorldEntity[];
  mechanics: WorldMechanic[];
  rulesRevision: number;
  rulesReady: boolean;
  facilitator: boolean;
  onChanged: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [skipError, setSkipError] = useState<ApiError | null>(null);
  const [terraIdempotencyKey] = useState(() => crypto.randomUUID());
  const terraFacilitated = world.facilitator.source === "terra";
  const agentFacilitated = world.facilitator.source === "agent";
  const automatedFacilitated = terraFacilitated || agentFacilitated;
  const canSkip =
    world.status === "active" &&
    automatedFacilitated &&
    interaction.facilitator_source === world.facilitator.source &&
    (interaction.status === "open" || interaction.status === "adjudicating") &&
    world.current_play_role === "player" &&
    world.play_status === "ready";
  const context = interaction.entity_ids
    .map((id) => entities.find((entity) => entity.id === id))
    .filter((item): item is WorldEntity => item !== undefined);

  async function command(action: "adjudicate" | "cancel") {
    setWorking(true);
    setError(null);
    try {
      await api<Interaction>(
        worldPath(world.id, `interactions/${interaction.id}/${action}`),
        {
          method: "POST",
          ...jsonBody({ expected_revision: interaction.revision }),
        },
      );
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(
              0,
              "unknown",
              "The problem changed before that action completed.",
            ),
      );
    } finally {
      setWorking(false);
    }
  }

  async function letTerraDecide() {
    setWorking(true);
    setError(null);
    try {
      await api<InteractionResolutionResult>(
        worldPath(world.id, `interactions/${interaction.id}/auto-dm/decide`),
        {
          method: "POST",
          ...jsonBody({
            expected_revision: interaction.revision,
            expected_rules_revision: rulesRevision,
            idempotency_key: terraIdempotencyKey,
          }),
        },
      );
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Terra could not decide the outcome."),
      );
      onChanged();
    } finally {
      setWorking(false);
    }
  }

  async function skipProblem() {
    if (
      !window.confirm(
        `Skip this problem? Submitted actions will not affect the world. ${agentFacilitated ? "ChatGPT" : "Terra"} will remain Dungeon Master, and you can ask for another problem.`,
      )
    )
      return;
    setSkipping(true);
    setSkipError(null);
    try {
      await api<Interaction>(
        worldPath(world.id, `interactions/${interaction.id}/cancel`),
        {
          method: "POST",
          ...jsonBody({ expected_revision: interaction.revision }),
        },
      );
      onChanged();
    } catch (reason) {
      const issue =
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not skip this problem.");
      setSkipError(issue);
      if (issue.status === 409) onChanged();
    } finally {
      setSkipping(false);
    }
  }

  return (
    <LiveInteractionView
      model={{
        status: interaction.status,
        statusLabel:
          interaction.status === "open"
            ? "Accepting actions"
            : agentFacilitated
              ? "ChatGPT is resolving"
              : terraFacilitated
                ? "Terra is deciding"
                : "Closed for actions",
        presentedLabel: formatRelativeDate(
          interaction.presented_at ?? interaction.created_at,
        ),
        title: interaction.title ?? "Problem",
        prompt: interaction.prompt,
        contextEntityNames: context.map((entity) => entity.display_name),
        facilitator,
        canSkip,
        working,
        skipping,
        issue:
          interaction.status === "adjudicating" && terraFacilitated
            ? null
            : toPlayViewIssue(skipError ?? error),
      }}
      content={
        <>
          {interaction.status === "open" ? (
            <OpenProblem
              interaction={interaction}
              world={world}
              membership={membership}
              entities={entities}
              facilitator={facilitator}
              terraFacilitated={terraFacilitated}
              agentFacilitated={agentFacilitated}
              rulesReady={rulesReady}
              working={working}
              onAdjudicate={() => void command("adjudicate")}
              onRequestDecision={() => void letTerraDecide()}
              onChanged={onChanged}
            />
          ) : null}
          {interaction.status === "adjudicating" && facilitator ? (
            <RulingEditor
              interaction={interaction}
              world={world}
              entities={entities}
              mechanics={mechanics}
              rulesRevision={rulesRevision}
              rulesReady={rulesReady}
              onResolved={onChanged}
            />
          ) : null}
          {interaction.status === "adjudicating" && terraFacilitated ? (
            <TerraDecisionPendingView
              retrying={working}
              issue={toPlayViewIssue(skipError ?? error)}
              onRetry={() => void letTerraDecide()}
            />
          ) : null}
          {interaction.status === "adjudicating" && agentFacilitated ? (
            <AgentDecisionPendingView />
          ) : null}
        </>
      }
      onCancel={() => void command("cancel")}
      onSkip={() => void skipProblem()}
    />
  );
}

function OpenProblem({
  interaction,
  world,
  membership,
  entities,
  facilitator,
  terraFacilitated,
  agentFacilitated,
  rulesReady,
  working,
  onAdjudicate,
  onRequestDecision,
  onChanged,
}: {
  interaction: Interaction;
  world: World;
  membership: WorldMember;
  entities: WorldEntity[];
  facilitator: boolean;
  terraFacilitated: boolean;
  agentFacilitated: boolean;
  rulesReady: boolean;
  working: boolean;
  onAdjudicate: () => void;
  onRequestDecision: () => void;
  onChanged: () => void;
}) {
  const player = world.current_play_role === "player";
  const eligible =
    player &&
    interaction.eligible_responder_membership_ids.includes(membership.id);
  const currentAction = interaction.actions.find(
    (action) =>
      action.submitted_by_membership_id === membership.id &&
      action.status === "submitted",
  );
  const [text, setText] = useState("");
  const controlledEntities = membership.controlled_entity_ids
    .map((id) => entities.find((entity) => entity.id === id))
    .filter(
      (entity): entity is WorldEntity =>
        entity !== undefined &&
        !entity.archived &&
        entity.character_status === "ready",
    );
  const [actingEntityID, setActingEntityID] = useState(
    controlledEntities.length === 1 ? (controlledEntities[0]?.id ?? "") : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(actionText = text.trim(), passing = false) {
    setSaving(true);
    setError(null);
    try {
      await api<InteractionAction>(
        worldPath(world.id, `interactions/${interaction.id}/actions`),
        {
          method: "POST",
          ...jsonBody({
            text: actionText,
            ...(passing
              ? {}
              : { acting_entity_id: actingEntityID || undefined }),
            expected_revision: interaction.revision,
          }),
        },
      );
      setText("");
      onChanged();
      setSaving(false);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not submit your action."),
      );
      setSaving(false);
    }
  }

  async function withdraw() {
    if (currentAction === undefined) return;
    setSaving(true);
    setError(null);
    try {
      await api<InteractionAction>(
        worldPath(
          world.id,
          `interactions/${interaction.id}/actions/${currentAction.id}/withdraw`,
        ),
        {
          method: "POST",
          ...jsonBody({ expected_revision: currentAction.revision }),
        },
      );
      onChanged();
      setSaving(false);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not withdraw your action."),
      );
      setSaving(false);
    }
  }

  const submitted = interaction.actions.filter(
    (action) => action.status === "submitted",
  );
  const respondedMembershipIDs = new Set(
    submitted.map((action) => action.submitted_by_membership_id),
  );
  const respondedCount = interaction.eligible_responder_membership_ids.filter(
    (membershipID) => respondedMembershipIDs.has(membershipID),
  ).length;
  const responderCount = interaction.eligible_responder_membership_ids.length;
  const allRespondersReady = respondedCount === responderCount;
  return (
    <OpenProblemView
      model={{
        submissions: submitted.map(toSubmittedActionViewModel),
        facilitator,
        eligibleResponder: eligible,
        actionSubmitted: currentAction !== undefined,
        controlledEntities: controlledEntities.map((entity) => ({
          id: entity.id,
          name: entity.display_name,
        })),
        actingEntityId: actingEntityID,
        actionText: text,
        saving,
        closing: working,
        terraFacilitated,
        agentFacilitated,
        canRequestDecision: terraFacilitated && player,
        allRespondersReady,
        decisionEnabled: rulesReady,
        responseProgressLabel: !rulesReady
          ? "Refreshing the current rules and entity state."
          : responderCount === 0
            ? "No player responses are required."
            : `${respondedCount} of ${responderCount} responders have acted or passed.`,
        deciding: working,
        issue: toPlayViewIssue(error),
      }}
      actions={{
        changeActingEntity: setActingEntityID,
        changeActionText: setText,
        submitAction: () => void submit(),
        passAction: () => void submit("I pass.", true),
        withdrawAction: () => void withdraw(),
        closeActions: onAdjudicate,
        requestDecision: onRequestDecision,
      }}
    />
  );
}

function RulingEditor({
  interaction,
  world,
  entities,
  mechanics,
  rulesRevision,
  rulesReady,
  onResolved,
}: {
  interaction: Interaction;
  world: World;
  entities: WorldEntity[];
  mechanics: WorldMechanic[];
  rulesRevision: number;
  rulesReady: boolean;
  onResolved: () => void;
}) {
  const submitted = interaction.actions.filter(
    (action) => action.status === "submitted",
  );
  const [narrative, setNarrative] = useState("");
  const [compilation, setCompilation] = useState<{
    contextKey: string;
    result: ConsequenceCompilation;
  } | null>(null);
  const [saving, setSaving] = useState<"compile" | "resolve" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const contextKey = JSON.stringify({
    world_revision: world.revision,
    interaction_revision: interaction.revision,
    rules_revision: rulesRevision,
    entity_versions: entities.map((entity) => [
      entity.id,
      entity.archived,
      entity.character_status,
      entity.state.revision,
      entity.state.status_revision,
      entity.state.rules_revision,
    ]),
  });
  const compiled =
    compilation?.contextKey === contextKey &&
    compilation.result.narrative.trim() === narrative.trim()
      ? compilation.result
      : null;
  const selectedAction =
    compiled?.selected_action_id === undefined
      ? undefined
      : submitted.find((action) => action.id === compiled.selected_action_id);

  async function prepareConsequence() {
    const requestContextKey = contextKey;
    setSaving("compile");
    setError(null);
    try {
      const result = await api<ConsequenceCompilation>(
        worldPath(
          world.id,
          `interactions/${interaction.id}/compile-consequence`,
        ),
        {
          method: "POST",
          ...jsonBody({
            expected_revision: interaction.revision,
            expected_rules_revision: rulesRevision,
            narrative: narrative.trim(),
          }),
        },
      );
      if (result.narrative.trim() === "")
        throw new ApiError(
          502,
          "invalid_response",
          "The consequence did not include what transpires.",
        );
      setNarrative(result.narrative.trim());
      setCompilation({ contextKey: requestContextKey, result });
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not interpret this consequence."),
      );
    } finally {
      setSaving(null);
    }
  }

  async function resolve() {
    if (compiled === null) return;
    setSaving("resolve");
    setError(null);
    try {
      await api<InteractionResolutionResult>(
        worldPath(world.id, `interactions/${interaction.id}/resolve`),
        {
          method: "POST",
          ...jsonBody({
            expected_revision: interaction.revision,
            expected_rules_revision: rulesRevision,
            idempotency_key: idempotencyKey,
            selected_action_id: compiled.selected_action_id,
            action_summary: compiled.action_summary,
            narrative: compiled.narrative,
            effects: compiled.effects,
          }),
        },
      );
      onResolved();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not resolve this problem."),
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <RulingView
      model={{
        submissions: submitted.map(toSubmittedActionViewModel),
        narrative,
        selectedAction:
          selectedAction === undefined
            ? null
            : {
                actorName:
                  selectedAction.acting_entity_name ??
                  selectedAction.submitted_by_name ??
                  "the selected action",
                text: selectedAction.text,
              },
        preview:
          compiled === null
            ? null
            : toRulingPreviewViewModel(compiled.preview, entities, mechanics),
        rulesReady,
        previewStale: compilation !== null && compiled === null,
        saving,
        issue: toPlayViewIssue(error, { narrative: "narrative" }),
      }}
      actions={{
        changeNarrative: (value) => {
          setNarrative(value);
          setCompilation(null);
          setError(null);
        },
        prepare: () => void prepareConsequence(),
        resolve: () => void resolve(),
      }}
    />
  );
}

function toPlayViewIssue(
  error: ApiError | null,
  fieldNames: Record<string, string> = {},
): PlayViewIssue | null {
  if (error === null) return null;
  return {
    ...toErrorNotice(error),
    fields: Object.fromEntries(
      Object.entries(fieldNames).flatMap(([transportField, viewField]) => {
        const message = error.fields[transportField];
        return message === undefined ? [] : [[viewField, message]];
      }),
    ),
  };
}

function toSubmittedActionViewModel(
  action: InteractionAction,
): SubmittedActionViewModel {
  return {
    id: action.id,
    actorName:
      action.acting_entity_name ?? action.submitted_by_name ?? "Player",
    ...(action.acting_entity_name === undefined
      ? {}
      : { playerName: action.submitted_by_name ?? "Player" }),
    text: action.text,
  };
}

function toRulingPreviewViewModel(
  result: InteractionResolutionResult,
  entities: WorldEntity[],
  mechanics: WorldMechanic[],
): RulingPreviewViewModel {
  return {
    applicationSummary:
      result.applied_effects.length === 0
        ? "Narrative only"
        : `${result.applied_effects.length} state ${result.applied_effects.length === 1 ? "application" : "applications"}`,
    applications: result.applied_effects.map((effect, index) => ({
      id: `${effect.effect_id}:${effect.entity_id}:${index}`,
      entityName:
        entities.find((entity) => entity.id === effect.entity_id)
          ?.display_name ?? "Entity",
      effectLabel:
        effect.type === "apply-status"
          ? `Applied ${effect.status_name ?? "status"}`
          : effect.type === "remove-status"
            ? `Removed ${effect.status_name ?? "status"}`
            : (mechanics.find((mechanic) => mechanic.id === effect.mechanic_id)
                ?.name ?? "Mechanic"),
      outcomeLabel:
        effect.type === "apply-status" || effect.type === "remove-status"
          ? effect.changed
            ? "changed"
            : "already current"
          : `${displayValue(effect.before)} → ${displayValue(effect.after)}`,
    })),
    effectiveChanges: result.effective_changes.map((change) => ({
      id: `${change.entity_id}:${change.mechanic_id}`,
      label: `${
        entities.find((entity) => entity.id === change.entity_id)
          ?.display_name ?? "Entity"
      } · ${
        mechanics.find((mechanic) => mechanic.id === change.mechanic_id)
          ?.name ?? "Mechanic"
      }`,
      outcomeLabel: `${displayValue(change.before)} → ${displayValue(change.after)}`,
    })),
  };
}

function toHistoryCardViewModel(
  interaction: Interaction,
  entities: WorldEntity[],
  mechanics: WorldMechanic[],
  memberships: WorldMember[],
): HistoryCardViewModel {
  const facilitatorSource =
    interaction.resolution?.facilitator_source ??
    interaction.facilitator_source;
  const facilitatorMembershipID =
    interaction.resolution?.resolved_by_membership_id ??
    interaction.created_by_membership_id;
  const facilitatorLabel =
    facilitatorSource === "terra"
      ? "Terra Auto DM"
      : facilitatorSource === "agent"
        ? "ChatGPT"
        : (memberships.find(
            (membership) => membership.id === facilitatorMembershipID,
          )?.display_name ?? "Human facilitator");
  if (interaction.status === "cancelled")
    return {
      id: interaction.id,
      outcome: "cancelled",
      cancellationLabel:
        facilitatorSource === "human" ? "Cancelled" : "Skipped",
      occurredLabel: formatRelativeDate(interaction.cancelled_at),
      facilitatorLabel,
      title: interaction.title ?? "Untitled problem",
      prompt: interaction.prompt,
      effects: [],
      effectiveChanges: [],
    };
  const resolution = interaction.resolution;
  return {
    id: interaction.id,
    outcome: "resolved",
    occurredLabel: formatRelativeDate(interaction.resolved_at),
    facilitatorLabel,
    title: interaction.title ?? "Untitled problem",
    prompt: interaction.prompt,
    ...(resolution === undefined ? {} : { narrative: resolution.narrative }),
    effects:
      resolution?.applied_effects.map((effect, index) => ({
        id: `${effect.effect_id}:${effect.entity_id}:${index}`,
        label: `${
          entities.find((entity) => entity.id === effect.entity_id)
            ?.display_name ?? "Entity"
        }: ${
          effect.type === "apply-status"
            ? `applied ${effect.status_name ?? "status"}`
            : effect.type === "remove-status"
              ? `removed ${effect.status_name ?? "status"}`
              : `${
                  mechanics.find((item) => item.id === effect.mechanic_id)
                    ?.name ?? "mechanic"
                } ${displayValue(effect.before)} → ${displayValue(effect.after)}`
        }`,
      })) ?? [],
    effectiveChanges:
      resolution?.effective_changes.map((change) => ({
        id: `${change.entity_id}:${change.mechanic_id}`,
        label: `${
          entities.find((entity) => entity.id === change.entity_id)
            ?.display_name ?? "Entity"
        }: ${
          mechanics.find((mechanic) => mechanic.id === change.mechanic_id)
            ?.name ?? "mechanic"
        } ${displayValue(change.before)} → ${displayValue(change.after)}`,
      })) ?? [],
  };
}

function displayValue(value?: StateValue): string {
  if (value === undefined) return "unknown";
  return value.kind === "number" ? value.value : value.value ? "yes" : "no";
}

function entitySubtitle(
  entity: WorldEntity,
  mechanics: WorldMechanic[],
  memberships: WorldMember[],
  currentMembershipID: string,
): string {
  if (
    memberships.some(
      (membership) =>
        membership.id === currentMembershipID &&
        membership.status === "active" &&
        membership.controlled_entity_ids.includes(entity.id),
    )
  ) {
    return entity.character_status === "ready"
      ? "Your character"
      : `Your character · Setup ${entity.completed_field_count}/${entity.required_field_count}`;
  }
  const controllers = memberships.filter(
    (membership) =>
      membership.status === "active" &&
      membership.role !== "spectator" &&
      membership.controlled_entity_ids.includes(entity.id),
  );
  if (controllers.length > 0) {
    const label =
      entity.character_status === "ready" ? "Character" : "Character setup";
    return `${label} · ${controllers.map((membership) => membership.display_name).join(", ")}`;
  }
  const capacity = mechanics.find(
    (mechanic) => mechanic.kind === "capacity" && !mechanic.archived,
  );
  if (capacity === undefined) return "Sheet ready";
  return `${capacity.name} ${displayValue(
    entity.state.effective_values[capacity.id] ??
      entity.state.values[capacity.id],
  )}`;
}
