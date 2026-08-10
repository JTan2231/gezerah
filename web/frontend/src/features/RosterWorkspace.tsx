import { useCallback, useEffect, useState } from "react";

import { toErrorNotice, worldPath } from "../api/client";
import type {
  World,
  WorldEntity,
  WorldMechanicCollection,
  WorldMember,
} from "../api/types";
import { useCollection } from "../hooks/useCollection";
import { confirmDiscardDraft } from "../hooks/useDraft";
import { useResource } from "../hooks/useResource";
import { EntityDetail } from "./EntityDetail";
import { ManageControllersModal, NewEntityModal } from "./RosterModals";
import { RosterView } from "./RosterView";

export function RosterWorkspace({
  world,
  onWorldChanged,
}: {
  world: World;
  onWorldChanged: () => void;
}) {
  const entities = useCollection<WorldEntity>(worldPath(world.id, "entities"));
  const mechanics = useResource<WorldMechanicCollection>(
    worldPath(world.id, "mechanics"),
  );
  const members = useCollection<WorldMember>(worldPath(world.id, "members"));
  const [addingEntity, setAddingEntity] = useState(false);
  const [managingControllersFor, setManagingControllersFor] = useState<
    string | undefined
  >();
  const [selectedEntityId, setSelectedEntityId] = useState<
    string | undefined
  >();
  const [profileRefreshToken, setProfileRefreshToken] = useState(0);
  const activeEntities = entities.items.filter((entity) => !entity.archived);
  const selectedEntity =
    activeEntities.find((entity) => entity.id === selectedEntityId) ??
    activeEntities[0];

  const reloadEntities = entities.reload;
  const reloadMembers = members.reload;
  const reloadMechanics = mechanics.reload;
  const entityItems = entities.items;
  const entitiesLoading = entities.loading;
  const mechanicsLoading = mechanics.loading;
  const mechanicCollection = mechanics.value;
  const refresh = useCallback(() => {
    reloadEntities();
    reloadMembers();
    reloadMechanics();
    onWorldChanged();
    setProfileRefreshToken((value) => value + 1);
  }, [onWorldChanged, reloadEntities, reloadMechanics, reloadMembers]);

  function selectEntity(entityId: string) {
    if (!confirmDiscardDraft()) return;
    setSelectedEntityId(entityId);
  }

  function startAddingEntity() {
    if (!confirmDiscardDraft()) return;
    setAddingEntity(true);
  }

  useEffect(() => {
    const rulesRevision = mechanicCollection?.revision;
    if (
      rulesRevision === undefined ||
      mechanicsLoading ||
      entitiesLoading ||
      !entityItems.some(
        (entity) => entity.state.rules_revision !== rulesRevision,
      )
    )
      return;
    reloadMechanics();
    reloadEntities();
  }, [
    entitiesLoading,
    entityItems,
    mechanicCollection?.revision,
    mechanicsLoading,
    reloadEntities,
    reloadMechanics,
  ]);

  const currentMembership = members.items.find(
    (membership) => membership.id === world.membership_id,
  );
  const firstError = entities.error ?? mechanics.error ?? members.error;
  const mechanicItems = mechanics.value?.mechanics ?? [];
  const preparing =
    (entities.loading && entities.items.length === 0) ||
    (mechanics.loading && mechanics.value === null) ||
    (members.loading && members.items.length === 0);

  return (
    <RosterView
      preparing={preparing}
      active={world.status === "active"}
      loading={entities.loading}
      issue={firstError === null ? null : toErrorNotice(firstError)}
      entities={activeEntities.map((entity) => ({
        id: entity.id,
        displayName: entity.display_name,
        subtitle: rosterSubtitle(
          entity,
          members.items,
          currentMembership?.id ?? "",
        ),
      }))}
      selectedEntityId={selectedEntity?.id}
      onCreateEntity={startAddingEntity}
      onRetry={refresh}
      onSelectEntity={selectEntity}
      detail={
        selectedEntity === undefined ? null : (
          <EntityDetail
            key={`${selectedEntity.id}:${selectedEntity.state.revision}:${selectedEntity.state.status_revision}:${selectedEntity.state.rules_revision}:${mechanicItems.map((mechanic) => `${mechanic.id}:${mechanic.updated_at}`).join(":")}`}
            entity={selectedEntity}
            mechanics={mechanicItems}
            rulesRevision={mechanicCollection?.revision ?? world.rules_revision}
            mechanicsEditable={world.status === "active"}
            controlledByCurrentMember={false}
            facilitator
            world={world}
            profileRefreshToken={profileRefreshToken}
            onManageControllers={() =>
              setManagingControllersFor(selectedEntity.id)
            }
            onProfileChanged={refresh}
            onSaved={refresh}
          />
        )
      }
      overlays={
        <>
          {addingEntity ? (
            <NewEntityModal
              world={world}
              members={members.items}
              onClose={() => setAddingEntity(false)}
              onCreated={(entity) => {
                entities.replaceItem(entity, (item) => item.id);
                setSelectedEntityId(entity.id);
                setAddingEntity(false);
                refresh();
              }}
            />
          ) : null}
          {managingControllersFor === undefined ? null : (
            <ManageControllersModal
              world={world}
              entity={entities.items.find(
                (entity) => entity.id === managingControllersFor,
              )}
              members={members.items}
              onClose={() => setManagingControllersFor(undefined)}
              onSaved={() => {
                setManagingControllersFor(undefined);
                refresh();
              }}
            />
          )}
        </>
      }
    />
  );
}

function rosterSubtitle(
  entity: WorldEntity,
  memberships: WorldMember[],
  currentMembershipID: string,
): string {
  const controllers = memberships.filter(
    (membership) =>
      membership.status === "active" &&
      membership.role === "player" &&
      membership.controlled_entity_ids.includes(entity.id),
  );
  if (controllers.length === 0) return "Uncontrolled entity";
  const readiness =
    entity.character_status === "ready"
      ? "Ready"
      : `Setup ${entity.completed_field_count}/${entity.required_field_count}`;
  const names = controllers
    .map((membership) =>
      membership.id === currentMembershipID ? "You" : membership.display_name,
    )
    .join(", ");
  return `${readiness} · ${names}`;
}
