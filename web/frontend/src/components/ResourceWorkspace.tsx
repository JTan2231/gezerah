import { useState, type ReactNode } from "react";

import { EmptyState, ErrorNotice, LoadingRows, Panel, StatusBadge } from "./ui";
import type { ApiError } from "../api/client";
import { confirmDiscardDraft } from "../hooks/useDraft";

export function ResourceWorkspace<T>({
  title,
  items,
  selectedId,
  getId,
  getTitle,
  getMeta,
  getGroup,
  isArchived,
  loading,
  error,
  onRetry,
  onSelect,
  onCreate,
  createLabel,
  emptyTitle,
  emptyDescription,
  children,
}: {
  title: string;
  items: T[];
  selectedId: string | null;
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  getMeta: (item: T) => string;
  getGroup?: (item: T) => string;
  isArchived?: (item: T) => boolean;
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  onSelect: (item: T) => void;
  onCreate: () => void;
  createLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<
    "active" | "archived" | "all"
  >("active");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredItems = items.filter((item) => {
    const archiveMatches =
      isArchived === undefined ||
      archiveFilter === "all" ||
      isArchived(item) === (archiveFilter === "archived");
    const queryMatches =
      normalizedQuery === "" ||
      `${getTitle(item)} ${getMeta(item)}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    return archiveMatches && queryMatches;
  });
  const groupedItems = (() => {
    if (getGroup === undefined)
      return [{ label: "", items: filteredItems }] as const;
    const groups = new Map<string, T[]>();
    for (const item of filteredItems) {
      const label = getGroup(item);
      const group = groups.get(label);
      if (group === undefined) groups.set(label, [item]);
      else group.push(item);
    }
    return [...groups].map(([label, groupItems]) => ({
      label,
      items: groupItems,
    }));
  })();
  return (
    <div className="resource-workspace">
      <Panel
        className="resource-list"
        title={title}
        actions={
          <button
            type="button"
            onClick={() => {
              if (confirmDiscardDraft()) onCreate();
            }}
          >
            + {createLabel}
          </button>
        }
      >
        {items.length === 0 ? null : (
          <div className="list-tools">
            <label>
              <span className="visually-hidden">Search {title}</span>
              <input
                type="search"
                value={query}
                placeholder="Search"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            {isArchived === undefined ? null : (
              <label>
                <span className="visually-hidden">Archive filter</span>
                <select
                  value={archiveFilter}
                  onChange={(event) =>
                    setArchiveFilter(
                      event.currentTarget.value as
                        "active" | "archived" | "all",
                    )
                  }
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All</option>
                </select>
              </label>
            )}
          </div>
        )}
        {loading ? <LoadingRows /> : null}
        {error === null ? null : (
          <ErrorNotice error={error} onRetry={onRetry} />
        )}
        {!loading && error === null && items.length === 0 ? (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            action={
              <button
                onClick={() => {
                  if (confirmDiscardDraft()) onCreate();
                }}
              >
                Create the first one
              </button>
            }
          />
        ) : null}
        {!loading &&
        error === null &&
        items.length > 0 &&
        filteredItems.length === 0 ? (
          <p className="quiet-empty">No resources match these filters.</p>
        ) : null}
        <div className="resource-rows">
          {groupedItems.map((group) => (
            <section className="resource-group" key={group.label}>
              {getGroup === undefined ? null : (
                <h3 className="resource-group-label">{group.label}</h3>
              )}
              {group.items.map((item) => {
                const id = getId(item);
                return (
                  <button
                    className={`resource-row ${selectedId === id ? "resource-selected" : ""}`}
                    type="button"
                    key={id}
                    onClick={() => {
                      if (confirmDiscardDraft()) onSelect(item);
                    }}
                  >
                    <span>
                      <strong>{getTitle(item)}</strong>
                      <small>{getMeta(item)}</small>
                    </span>
                    {isArchived?.(item) === true ? (
                      <StatusBadge>Archived</StatusBadge>
                    ) : null}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </Panel>
      <div className="resource-editor">{children}</div>
    </div>
  );
}
