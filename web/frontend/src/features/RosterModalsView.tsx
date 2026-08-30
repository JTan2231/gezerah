import { Avatar, ErrorMessage, Field, Modal } from "../components/StudioUI";

export interface RosterModalIssue {
  kind: "connection" | "request";
  message: string;
  fields: { displayName?: string | undefined };
}

interface EligibleControllerViewModel {
  id: string;
  displayName: string;
}

export function NewEntityModalView({
  name,
  controllerIds,
  eligibleControllers,
  saving,
  issue,
  onNameChange,
  onToggleController,
  onClose,
  onSubmit,
}: {
  name: string;
  controllerIds: string[];
  eligibleControllers: EligibleControllerViewModel[];
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
        {eligibleControllers.length === 0 ? null : (
          <fieldset className="choice-fieldset controller-picker">
            <legend>
              Controlled by <small>Optional</small>
            </legend>
            <ControllerChoices
              eligibleControllers={eligibleControllers}
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
  eligibleControllers,
  saving,
  issue,
  onToggleController,
  onClose,
  onSubmit,
}: {
  entityName: string;
  controllerIds: string[];
  eligibleControllers: EligibleControllerViewModel[];
  saving: boolean;
  issue: RosterModalIssue | null;
  onToggleController: (membershipId: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      title="Manage Entity controllers"
      description={`Choose which eligible members control ${entityName}.`}
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {eligibleControllers.length === 0 ? (
          <p className="modal-note">
            No active owner, editor, or player is available. Saving now will
            leave this as an uncontrolled world entity.
          </p>
        ) : (
          <fieldset className="choice-fieldset controller-picker">
            <legend>Controllers</legend>
            <ControllerChoices
              eligibleControllers={eligibleControllers}
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
  eligibleControllers,
  controllerIds,
  onToggle,
}: {
  eligibleControllers: EligibleControllerViewModel[];
  controllerIds: string[];
  onToggle: (membershipId: string) => void;
}) {
  return (
    <div className="controller-picker-options">
      {eligibleControllers.map((controller) => (
        <label key={controller.id}>
          <input
            type="checkbox"
            checked={controllerIds.includes(controller.id)}
            onChange={() => onToggle(controller.id)}
          />
          <Avatar name={controller.displayName} size="small" />
          <span>{controller.displayName}</span>
        </label>
      ))}
    </div>
  );
}
