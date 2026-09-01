import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "../api/client";

export function useResource<T>(path: string | null) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    path: string | null;
    value: T | null;
    loading: boolean;
    error: ApiError | null;
  }>({ path, value: null, loading: path !== null, error: null });

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (path === null) {
      setState({ path, value: null, loading: false, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setState((current) => ({
      path,
      value: current.path === path ? current.value : null,
      loading: true,
      error: null,
    }));
    void api<T>(path, { signal: controller.signal })
      .then((value) => setState({ path, value, loading: false, error: null }))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          path,
          value: current.path === path ? current.value : null,
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
      : { path, value: null, loading: path !== null, error: null };
  return { ...current, reload };
}
