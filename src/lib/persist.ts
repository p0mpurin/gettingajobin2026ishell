import { useEffect, useState } from "react";

const KEY = "bolzano-jobs.ui";

function readAll(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

/**
 * useState that survives restarts, for UI preferences only (view, filters,
 * sort). Falls back to the default when storage is unavailable or the stored
 * value isn't one of the allowed options.
 */
export function usePersisted<T extends string>(name: string, fallback: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    const v = readAll()[name];
    return allowed.includes(v as T) ? (v as T) : fallback;
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [name]: value }));
    } catch {
      /* storage blocked: preference just isn't remembered */
    }
  }, [name, value]);
  return [value, setValue] as const;
}
