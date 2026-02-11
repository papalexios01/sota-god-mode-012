// src/hooks/useDebounce.ts
import { useRef, useCallback } from 'react';

/**
 * Higher-order hook for debouncing callback functions.
 * Prevents rapid-fire function calls during high-frequency events.
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delayMs: number = 300
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback((...args: any[]) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delayMs);
  }, [delayMs]) as T;
}
