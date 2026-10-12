"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

interface LoadState<T> {
  key: string;
  data: T | undefined;
  error: Error | null;
}

/**
 * Loads data for `key`, keeping the previous data visible while a new key
 * loads so filters do not flash empty. `setData` applies mutation responses
 * without another round trip.
 */
export function useLoad<T>(load: () => Promise<T>, key = "") {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<LoadState<T>>({ key: "\u0000", data: undefined, error: null });
  const run = useEffectEvent(load);
  const token = `${key}#${nonce}`;

  useEffect(() => {
    let cancelled = false;
    run().then(
      (data) => !cancelled && setState({ key: token, data, error: null }),
      (error: unknown) => !cancelled && setState((s) => ({ key: token, data: s.data, error: error instanceof Error ? error : new Error(String(error)) })),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((data: T) => setState((s) => ({ ...s, data, error: null })), []);

  return { data: state.data, error: state.key === token ? state.error : null, loading: state.key !== token, reload, setData };
}
