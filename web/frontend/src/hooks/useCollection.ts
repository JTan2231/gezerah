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
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const replaceItem = useCallback((item: T, id: (value: T) => string) => {
    setItems((current) => {
      const index = current.findIndex(
        (candidate) => id(candidate) === id(item),
      );
      if (index < 0) return [...current, item];
      return current.map((candidate, candidateIndex) =>
        candidateIndex === index ? item : candidate,
      );
    });
  }, []);

  useEffect(() => {
    if (path === null) {
      setItems([]);
      setLoading(false);
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api<T[]>(path, { signal: controller.signal })
      .then((response) => setItems(response))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof ApiError
            ? reason
            : new ApiError(0, "unknown", "Something went wrong."),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, version]);

  return { items, loading, error, reload, replaceItem };
}
