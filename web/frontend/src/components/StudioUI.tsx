import { useEffect, type ReactNode } from "react";

import { humanize } from "../domain/display";

export interface ErrorNotice {
  kind: "connection" | "request";
  message: string;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={compact ? "studio-brand studio-brand-compact" : "studio-brand"}
    >
      <strong>Gezerah</strong>
    </span>
  );
}

export function Avatar({
  name,
  size = "normal",
}: {
  name: string;
  size?: "small" | "normal";
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

export function PageIntro({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-intro">
      <div>
        <h1>{title}</h1>
        {description === undefined ? null : <p>{description}</p>}
      </div>
      {actions === undefined ? null : (
        <div className="page-actions">{actions}</div>
      )}
    </header>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className={error === undefined ? "field" : "field field-error"}>
      <span className="field-label">{label}</span>
      {children}
      {error === undefined ? null : (
        <span className="field-message">{error}</span>
      )}
      {error !== undefined || hint === undefined ? null : (
        <span className="field-hint">{hint}</span>
      )}
    </label>
  );
}

export function ErrorMessage({
  error,
  onRetry,
}: {
  error: ErrorNotice;
  onRetry?: () => void;
}) {
  return (
    <div className="notice notice-error" role="alert">
      <div>
        <strong>
          {error.kind === "connection"
            ? "Connection lost"
            : "That did not work"}
        </strong>
        <p>{error.message}</p>
      </div>
      {onRetry === undefined ? null : (
        <button className="button button-quiet" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {action === undefined ? null : <div>{action}</div>}
    </div>
  );
}

export function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <button
        className="modal-dismiss"
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description === undefined ? null : <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function RolePill({ role }: { role: string }) {
  return <span className={`role-pill role-${role}`}>{humanize(role)}</span>;
}
