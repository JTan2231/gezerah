import { useCallback, useEffect, useState } from "react";

import { worldPath } from "../api/client";
import type {
  World,
  WorldEntity,
  WorldMechanicCollection,
  WorldMember,
} from "../api/types";
import {
  EmptyState,
  ErrorMessage,
  LoadingState,
  PageIntro,
} from "../components/StudioUI";
import { useCollection } from "../hooks/useCollection";
import { confirmDiscardDraft } from "../hooks/useDraft";
import { useResource } from "../hooks/useResource";
import { EntityDetail } from "./EntityDetail";
import { ManageControllersModal, NewEntityModal } from "./RosterModals";

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
    onWorldChanged();
    setProfileRefreshToken((value) => value + 1);
  }, [onWorldChanged, reloadEntities, reloadMembers]);

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

  if (
    (entities.loading && entities.items.length === 0) ||
    (mechanics.loading && mechanics.value === null) ||
    (members.loading && members.items.length === 0)
  )
    return <LoadingState label="Preparing the roster" />;

  const currentMembership = members.items.find(
    (membership) => membership.id === world.membership_id,
  );
  const firstError = entities.error ?? mechanics.error ?? members.error;
  const mechanicItems = mechanics.value?.mechanics ?? [];

  return (
    <section className="roster-workspace content-narrow">
      <PageIntro
        eyebrow="Table preparation"
        title="Roster & sheets"
        description="Create ordinary world entities, assign player control, complete profiles, and make direct setup edits before entering Play."
        actions={
          world.status === "active" ? (
            <button
              className="button button-primary"
              type="button"
              onClick={startAddingEntity}
            >
              <span aria-hidden="true">＋</span> Create entity
            </button>
          ) : undefined
        }
      />

      {entities.loading && entities.items.length === 0 ? (
        <LoadingState label="Loading roster" />
      ) : null}
      {firstError === null ? null : (
        <ErrorMessage error={firstError} onRetry={refresh} />
      )}

      {!entities.loading &&
      firstError === null &&
      activeEntities.length === 0 ? (
        <div className="panel roster-builder-empty">
          <EmptyState
            symbol="○"
            title="No one is in this world yet"
            description="Create an entity and its sheet will be generated from every active capacity and capability."
            action={
              world.status === "active" ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={startAddingEntity}
                >
                  Create the first entity
                </button>
              ) : undefined
            }
          />
        </div>
      ) : null}

      {activeEntities.length > 0 ? (
        <div className="roster-builder-grid">
          <aside className="panel roster-builder-catalog">
            <header>
              <div>
                <p className="eyebrow">World entities</p>
                <h2>Prepared for the table</h2>
              </div>
              <span>{activeEntities.length}</span>
            </header>
            <div className="roster-builder-list">
              {activeEntities.map((entity) => (
                <button
                  className={entity.id === selectedEntity?.id ? "active" : ""}
                  type="button"
                  key={entity.id}
                  onClick={() => selectEntity(entity.id)}
                >
                  <span className="entity-token" aria-hidden="true">
                    {entity.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{entity.display_name}</strong>
                    <small>
                      {rosterSubtitle(
                        entity,
                        members.items,
                        currentMembership?.id ?? "",
                      )}
                    </small>
                  </span>
                  <b aria-hidden="true">›</b>
                </button>
              ))}
            </div>
          </aside>

          <div className="builder-entity-detail">
            {selectedEntity === undefined ? null : (
              <EntityDetail
                key={`${selectedEntity.id}:${selectedEntity.state.revision}:${selectedEntity.state.status_revision}:${selectedEntity.state.rules_revision}:${mechanicItems.map((mechanic) => `${mechanic.id}:${mechanic.updated_at}`).join(":")}`}
                entity={selectedEntity}
                mechanics={mechanicItems}
                rulesRevision={
                  mechanicCollection?.revision ?? world.rules_revision
                }
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
            )}
          </div>
        </div>
      ) : null}

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
    </section>
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
