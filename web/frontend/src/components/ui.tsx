import type { CSSProperties, PropsWithChildren, ReactNode } from "react";

import type { ApiError } from "../api/client";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="lede">{description}</p>
      </div>
      {actions === undefined ? null : (
        <div className="header-actions">{actions}</div>
      )}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
}: PropsWithChildren<{
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}>) {
  return (
    <section className={`panel ${className}`.trim()}>
      {title === undefined ? null : (
        <header className="panel-header">
          <div>
            <h2>{title}</h2>
            {description === undefined ? null : <p>{description}</p>}
          </div>
          {actions === undefined ? null : (
            <div className="compact-actions">{actions}</div>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  required = false,
  children,
}: PropsWithChildren<{
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
}>) {
  const description = `${label.toLowerCase().replaceAll(" ", "-")}-description`;
  return (
    <label className={`field ${error === undefined ? "" : "field-error"}`}>
      <span className="field-label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      {children}
      {error === undefined ? null : (
        <span className="error-text" id={description}>
          {error}
        </span>
      )}
      {error !== undefined || hint === undefined ? null : (
        <span className="field-hint" id={description}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function ModeGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  columns = 2,
}: {
  legend: string;
  value: T;
  options: Array<{
    value: T;
    label: string;
    description?: string | undefined;
    disabled?: boolean | undefined;
  }>;
  onChange: (value: T) => void;
  columns?: number;
}) {
  return (
    <fieldset className="mode-group">
      <legend>{legend}</legend>
      <div
        className="mode-options"
        style={{ "--mode-columns": columns } as CSSProperties}
      >
        {options.map((option) => (
          <label
            className={`mode-card ${value === option.value ? "mode-selected" : ""}`}
            key={option.value}
          >
            <input
              type="radio"
              checked={value === option.value}
              disabled={option.disabled === true}
              onChange={() => onChange(option.value)}
            />
            <span>
              <strong>{option.label}</strong>
              {option.description === undefined ? null : (
                <small>{option.description}</small>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CheckPicker({
  legend,
  help,
  options,
  selected,
  onChange,
  emptyLabel = "No options yet",
}: {
  legend: string;
  help?: string;
  options: Array<{
    id: string;
    label: string;
    description?: string | undefined;
    disabled?: boolean | undefined;
  }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: string;
}) {
  return (
    <fieldset className="check-picker">
      <legend>{legend}</legend>
      {help === undefined ? null : <p className="field-hint">{help}</p>}
      {options.length === 0 ? (
        <p className="quiet-empty">{emptyLabel}</p>
      ) : null}
      <div className="check-grid">
        {options.map((option) => (
          <label className="check-card" key={option.id}>
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              disabled={option.disabled === true}
              onChange={(event) => {
                onChange(
                  event.currentTarget.checked
                    ? [...selected, option.id]
                    : selected.filter((id) => id !== option.id),
                );
              }}
            />
            <span>
              <strong>{option.label}</strong>
              {option.description === undefined ? null : (
                <small>{option.description}</small>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SaveBar({
  dirty,
  saving,
  error,
  onSave,
  onReset,
  noun = "changes",
}: {
  dirty: boolean;
  saving: boolean;
  error: ApiError | null;
  onSave: () => void;
  onReset: () => void;
  noun?: string;
}) {
  return (
    <div className="save-bar" aria-live="polite">
      <div>
        <strong>
          {saving ? "Saving…" : dirty ? `Unsaved ${noun}` : "All changes saved"}
        </strong>
        {error === null ? null : (
          <span className="save-error">{error.message}</span>
        )}
      </div>
      <div className="compact-actions">
        <button
          className="button-secondary"
          type="button"
          disabled={!dirty || saving}
          onClick={onReset}
        >
          Reset
        </button>
        <button type="button" disabled={!dirty || saving} onClick={onSave}>
          {saving ? "Saving" : "Save"}
        </button>
      </div>
    </div>
  );
}

export function ErrorNotice({
  error,
  onRetry,
}: {
  error: ApiError;
  onRetry?: () => void;
}) {
  return (
    <div className="notice notice-error" role="alert">
      <div>
        <strong>
          {error.code === "network_error"
            ? "Server unavailable"
            : "Couldn’t load this view"}
        </strong>
        <p>{error.message}</p>
      </div>
      {onRetry === undefined ? null : (
        <button className="button-secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
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
      <span className="empty-mark" aria-hidden="true">
        ✦
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "good" | "warn" | "bad" | "info" }>) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

export function OrderedActions({
  index,
  count,
  label,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  label: string;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="ordered-actions" aria-label={`${label} actions`}>
      <button
        className="icon-button"
        type="button"
        disabled={index === 0}
        aria-label={`Move ${label} up`}
        onClick={() => onMove(-1)}
      >
        ↑
      </button>
      <button
        className="icon-button"
        type="button"
        disabled={index === count - 1}
        aria-label={`Move ${label} down`}
        onClick={() => onMove(1)}
      >
        ↓
      </button>
      <button
        className="icon-button danger-text"
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}

export function LoadingRows() {
  return (
    <div className="loading-rows" aria-label="Loading" aria-busy="true">
      <span />
      <span />
      <span />
    </div>
  );
}
