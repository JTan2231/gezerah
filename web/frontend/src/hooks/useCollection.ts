import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "../api/client";

interface CollectionState<T> {
  items: T[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  replaceItem: (item: T, id: (value: T) => string) => void;
}

export function useCollection<T>(path: string | null): CollectionState<T> {
  const [state, setState] = useState<{
    path: string | null;
    items: T[];
    loading: boolean;
    error: ApiError | null;
  }>({ path, items: [], loading: path !== null, error: null });
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const replaceItem = useCallback(
    (item: T, id: (value: T) => string) => {
      setState((current) => {
        if (current.path !== path) return current;
        const index = current.items.findIndex(
          (candidate) => id(candidate) === id(item),
        );
        const items =
          index < 0
            ? [...current.items, item]
            : current.items.map((candidate, candidateIndex) =>
                candidateIndex === index ? item : candidate,
              );
        return { ...current, items };
      });
    },
    [path],
  );

  useEffect(() => {
    if (path === null) {
      setState({ path, items: [], loading: false, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setState((current) => ({
      path,
      items: current.path === path ? current.items : [],
      loading: true,
      error: null,
    }));
    void api<T[]>(path, { signal: controller.signal })
      .then((response) =>
        setState({ path, items: response, loading: false, error: null }),
      )
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          path,
          items: current.path === path ? current.items : [],
          loading: false,
          error:
            reason instanceof ApiError
              ? reason
              : new ApiError(0, "unknown", "Something went wrong."),
        }));
      });
    return () => controller.abort();
  }, [path, version]);

  const current =
    state.path === path
      ? state
      : { path, items: [], loading: path !== null, error: null };
  return { ...current, reload, replaceItem };
}
