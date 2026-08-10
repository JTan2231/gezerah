import { Avatar, ErrorMessage, Field, Modal } from "../components/StudioUI";

export interface RosterModalIssue {
  kind: "connection" | "request";
  message: string;
  fields: { displayName?: string | undefined };
}

interface RosterPlayerViewModel {
  id: string;
  displayName: string;
}

export function NewEntityModalView({
  name,
  controllerIds,
  players,
  saving,
  issue,
  onNameChange,
  onToggleController,
  onClose,
  onSubmit,
}: {
  name: string;
  controllerIds: string[];
  players: RosterPlayerViewModel[];
  saving: boolean;
  issue: RosterModalIssue | null;
  onNameChange: (name: string) => void;
  onToggleController: (membershipId: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      title="Create an entity"
      description="Its sheet is generated from every active capacity and capability."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Field label="Display name" error={issue?.fields.displayName}>
          <input
            value={name}
            onChange={(event) => onNameChange(event.currentTarget.value)}
            maxLength={200}
            placeholder="Entity name"
          />
        </Field>
        {players.length === 0 ? null : (
          <fieldset className="choice-fieldset controller-picker">
            <legend>
              Controlled by <small>Optional</small>
            </legend>
            <ControllerChoices
              players={players}
              controllerIds={controllerIds}
              onToggle={onToggleController}
            />
          </fieldset>
        )}
        {issue === null ? null : <ErrorMessage error={issue} />}
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

export function ManageControllersModalView({
  entityName,
  controllerIds,
  players,
  saving,
  issue,
  onToggleController,
  onClose,
  onSubmit,
}: {
  entityName: string;
  controllerIds: string[];
  players: RosterPlayerViewModel[];
  saving: boolean;
  issue: RosterModalIssue | null;
  onToggleController: (membershipId: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      title="Manage character control"
      description={`Choose which players control ${entityName}.`}
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {players.length === 0 ? (
          <p className="modal-note">
            Invite a player before assigning control. Saving now will leave this
            as an uncontrolled world entity.
          </p>
        ) : (
          <fieldset className="choice-fieldset controller-picker">
            <legend>Player controllers</legend>
            <ControllerChoices
              players={players}
              controllerIds={controllerIds}
              onToggle={onToggleController}
            />
          </fieldset>
        )}
        {issue === null ? null : <ErrorMessage error={issue} />}
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

function ControllerChoices({
  players,
  controllerIds,
  onToggle,
}: {
  players: RosterPlayerViewModel[];
  controllerIds: string[];
  onToggle: (membershipId: string) => void;
}) {
  return (
    <div className="responder-picker">
      {players.map((player) => (
        <label key={player.id}>
          <input
            type="checkbox"
            checked={controllerIds.includes(player.id)}
            onChange={() => onToggle(player.id)}
          />
          <Avatar name={player.displayName} size="small" />
          <span>{player.displayName}</span>
        </label>
      ))}
    </div>
  );
}
