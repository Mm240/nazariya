import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiGet, cached } from './api';

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  /** True once a request has taken more than a few seconds: the free server is probably waking up. */
  slow: boolean;
  retry: () => void;
  /** Replace the data locally, e.g. after posting a comment. */
  setData: (data: T) => void;
}

/** `keepPrevious`: while a new path loads, keep showing the old data (e.g. "show more"). */
export function useApi<T>(path: string | null, keepPrevious = false, personal = false): ApiState<T> {
  const [state, setState] = useState<Omit<ApiState<T>, 'retry' | 'setData'>>(() => ({
    data: path ? cached<T>(path) : undefined,
    error: undefined,
    loading: Boolean(path),
    slow: false,
  }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const hit = cached<T>(path);
    setState((s) => ({ data: hit ?? (keepPrevious ? s.data : undefined), error: undefined, loading: !hit, slow: false }));
    const timer = window.setTimeout(() => setState((s) => (s.loading ? { ...s, slow: true } : s)), 4000);
    apiGet<T>(path, controller.signal, personal)
      .then((data) => setState({ data, error: undefined, loading: false, slow: false }))
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setState((s) => ({ ...s, error: err as ApiError, loading: false, slow: false }));
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [path, attempt, keepPrevious, personal]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback((data: T) => setState((s) => ({ ...s, data })), []);
  return { ...state, retry, setData };
}

export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} | Nazariya` : 'Nazariya: same news, different story';
  }, [title]);
}

/** Press "/" anywhere to focus the element (unless already typing). */
export function useSlashFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key !== '/' || target.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return ref;
}
