import { useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type { Game, World, WorldEntity, WorldMember } from "../api/types";
import { Avatar, ErrorMessage, Field, Modal } from "../components/StudioUI";

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
  const [error, setError] = useState<ApiError | null>(null);
  const players = members.filter(
    (member) => member.status === "active" && member.role === "player",
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
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
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create this entity."),
      );
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Create an entity"
      description="Its sheet is generated from every active capacity and capability."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={(event) => void submit(event)}>
        <Field label="Display name" error={error?.fields["display_name"]}>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={200}
            placeholder="Aria Vale"
          />
        </Field>
        {players.length === 0 ? null : (
          <fieldset className="choice-fieldset controller-picker">
            <legend>
              Controlled by <small>Optional</small>
            </legend>
            <div className="responder-picker">
              {players.map((member) => (
                <label key={member.id}>
                  <input
                    type="checkbox"
                    checked={controllerIDs.includes(member.id)}
                    onChange={() =>
                      setControllerIDs((current) =>
                        current.includes(member.id)
                          ? current.filter((id) => id !== member.id)
                          : [...current, member.id],
                      )
                    }
                  />
                  <Avatar name={member.display_name} size="small" />
                  <span>{member.display_name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {error === null ? null : <ErrorMessage error={error} />}
        <footer className="modal-actions">
          <button
            className="button button-quiet"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={saving || name.trim() === ""}
          >
            {saving ? "Creating…" : "Create entity"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function ManageControllersModal({
  world,
  game,
  entity,
  members,
  onClose,
  onSaved,
}: {
  world: World;
  game: Game;
  entity: WorldEntity | undefined;
  members: WorldMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const players = members.filter(
    (member) => member.status === "active" && member.role === "player",
  );
  const initialControllerIDs =
    entity === undefined
      ? []
      : players
          .filter((member) =>
            game.memberships.some(
              (gameMember) =>
                gameMember.user_id === member.user_id &&
                gameMember.controlled_entity_ids.includes(entity.id),
            ),
          )
          .map((member) => member.id);
  const [controllerIDs, setControllerIDs] = useState(initialControllerIDs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (entity === undefined) return null;
  const entityID = entity.id;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(worldPath(world.id, `entities/${entityID}/controllers`), {
        method: "PUT",
        ...jsonBody({
          expected_game_revision: game.revision,
          controller_world_membership_ids: controllerIDs,
        }),
      });
      onSaved();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not update character control."),
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Manage character control"
      description={`Choose which players may author ${entity.display_name}’s story and act as this entity.`}
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={(event) => void save(event)}>
        {players.length === 0 ? (
          <p className="modal-note">
            Invite a player before assigning control. Saving now will leave this
            as an uncontrolled world entity.
          </p>
        ) : (
          <fieldset className="choice-fieldset controller-picker">
            <legend>Player controllers</legend>
            <div className="responder-picker">
              {players.map((member) => (
                <label key={member.id}>
                  <input
                    type="checkbox"
                    checked={controllerIDs.includes(member.id)}
                    onChange={() =>
                      setControllerIDs((current) =>
                        current.includes(member.id)
                          ? current.filter((id) => id !== member.id)
                          : [...current, member.id],
                      )
                    }
                  />
                  <Avatar name={member.display_name} size="small" />
                  <span>{member.display_name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {error === null ? null : <ErrorMessage error={error} />}
        <footer className="modal-actions">
          <button
            className="button button-quiet"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save controllers"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
