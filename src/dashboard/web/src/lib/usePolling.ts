/**
 * Tiny polling hook. We don't need TanStack Query for one endpoint —
 * 2s setInterval + AbortController on unmount is enough.
 */
import * as React from "react";

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number = 2000,
): PollState<T> {
  const [state, setState] = React.useState<PollState<T>>({
    data: null,
    error: null,
    loading: true,
  });

  // Keep the fetcher in a ref so the interval doesn't restart on every render
  // (parent components recreate the closure each render otherwise).
  const fetcherRef = React.useRef(fetcher);
  React.useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  React.useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const data = await fetcherRef.current();
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({ ...s, error: (err as Error).message, loading: false }));
        }
      }
    };

    run();
    const id = window.setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return state;
}
