import { useEffect, useMemo, useState } from "react";

let dirtyEditorCount = 0;

export function useDirtyGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return undefined;
    dirtyEditorCount += 1;
    document.documentElement.dataset["draftDirty"] = "true";
    return () => {
      dirtyEditorCount = Math.max(0, dirtyEditorCount - 1);
      if (dirtyEditorCount === 0)
        delete document.documentElement.dataset["draftDirty"];
    };
  }, [dirty]);
}

export function confirmDiscardDraft(): boolean {
  if (document.documentElement.dataset["draftDirty"] !== "true") return true;
  return window.confirm(
    "Discard your unsaved changes? Your saved configuration will not be affected.",
  );
}

export function useDraft<T>(source: T) {
  const [draft, setDraft] = useState(source);
  const [baseline, setBaseline] = useState(source);

  useEffect(() => {
    setDraft(source);
    setBaseline(source);
  }, [source]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [baseline, draft],
  );
  useDirtyGuard(dirty);

  useEffect(() => {
    if (!dirty) return undefined;
    const protectDraft = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [dirty]);

  return {
    draft,
    setDraft,
    dirty,
    reset: () => setDraft(baseline),
    accept: (saved: T) => {
      setBaseline(saved);
      setDraft(saved);
    },
  };
}
