import { useState } from "react";

import {
  api,
  ApiError,
  jsonBody,
  toErrorNotice,
  worldPath,
} from "../api/client";
import type { World, WorldEntity, WorldMember } from "../api/types";
import {
  ManageControllersModalView,
  NewEntityModalView,
  type RosterModalIssue,
} from "./RosterModalsView";

export function NewEntityModal({
  world,
  members,
  onClose,
  onCreated,
}: {
  world: World;
  members: WorldMember[];
  onClose: () => void;
  onCreated: (entity: WorldEntity) => void;
}) {
  const [name, setName] = useState("");
  const [controllerIDs, setControllerIDs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<RosterModalIssue | null>(null);
  const eligibleControllers = members.filter(
    (member) => member.status === "active" && member.role !== "spectator",
  );
  async function submit() {
    setSaving(true);
    setIssue(null);
    try {
      const entity = await api<WorldEntity>(worldPath(world.id, "entities"), {
        method: "POST",
        ...jsonBody({
          display_name: name.trim(),
          controller_world_membership_ids: controllerIDs,
        }),
      });
      onCreated(entity);
    } catch (reason) {
      setIssue(toRosterModalIssue(reason, "Could not create this entity."));
      setSaving(false);
    }
  }
  return (
    <NewEntityModalView
      name={name}
      controllerIds={controllerIDs}
      eligibleControllers={eligibleControllers.map((controller) => ({
        id: controller.id,
        displayName: controller.display_name,
      }))}
      saving={saving}
      issue={issue}
      onNameChange={setName}
      onToggleController={(membershipId) =>
        setControllerIDs((current) =>
          current.includes(membershipId)
            ? current.filter((id) => id !== membershipId)
            : [...current, membershipId],
        )
      }
      onClose={onClose}
      onSubmit={() => void submit()}
    />
  );
}

export function ManageControllersModal({
  world,
  entity,
  members,
  onClose,
  onSaved,
}: {
  world: World;
  entity: WorldEntity | undefined;
  members: WorldMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const eligibleControllers = members.filter(
    (member) => member.status === "active" && member.role !== "spectator",
  );
  const initialControllerIDs =
    entity === undefined
      ? []
      : eligibleControllers
          .filter((member) => member.controlled_entity_ids.includes(entity.id))
          .map((member) => member.id);
  const [controllerIDs, setControllerIDs] = useState(initialControllerIDs);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<RosterModalIssue | null>(null);

  if (entity === undefined) return null;
  const entityID = entity.id;

  async function save() {
    setSaving(true);
    setIssue(null);
    try {
      await api(worldPath(world.id, `entities/${entityID}/controllers`), {
        method: "PUT",
        ...jsonBody({
          expected_roster_revision: world.roster_revision,
          controller_world_membership_ids: controllerIDs,
        }),
      });
      onSaved();
    } catch (reason) {
      setIssue(
        toRosterModalIssue(reason, "Could not update Entity controllers."),
      );
      setSaving(false);
    }
  }

  return (
    <ManageControllersModalView
      entityName={entity.display_name}
      controllerIds={controllerIDs}
      eligibleControllers={eligibleControllers.map((controller) => ({
        id: controller.id,
        displayName: controller.display_name,
      }))}
      saving={saving}
      issue={issue}
      onToggleController={(membershipId) =>
        setControllerIDs((current) =>
          current.includes(membershipId)
            ? current.filter((id) => id !== membershipId)
            : [...current, membershipId],
        )
      }
      onClose={onClose}
      onSubmit={() => void save()}
    />
  );
}

function toRosterModalIssue(
  reason: unknown,
  fallbackMessage: string,
): RosterModalIssue {
  if (!(reason instanceof ApiError))
    return { kind: "request", message: fallbackMessage, fields: {} };
  return {
    ...toErrorNotice(reason),
    fields: { displayName: reason.fields["display_name"] },
  };
}
