import { useCallback, useEffect, useMemo, useRef, useState } from "react";

let dirtyEditorCount = 0;

export function useDirtyGuard(dirty: boolean) {
  const registered = useRef(false);
  const setRegistered = useCallback((next: boolean) => {
    if (registered.current === next) return;
    registered.current = next;
    dirtyEditorCount = Math.max(0, dirtyEditorCount + (next ? 1 : -1));
    if (dirtyEditorCount === 0)
      delete document.documentElement.dataset["draftDirty"];
    else document.documentElement.dataset["draftDirty"] = "true";
  }, []);

  useEffect(() => {
    setRegistered(dirty);
    return () => setRegistered(false);
  }, [dirty, setRegistered]);

  return useCallback(() => setRegistered(false), [setRegistered]);
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
  const clearDirtyGuard = useDirtyGuard(dirty);

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
      // Successful saves may navigate before React has committed the new
      // baseline. Clear this editor's registration synchronously so that
      // navigation is not mistaken for discarding the just-saved draft.
      clearDirtyGuard();
      setBaseline(saved);
      setDraft(saved);
    },
  };
}
