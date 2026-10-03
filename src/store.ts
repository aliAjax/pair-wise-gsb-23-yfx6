import { useSyncExternalStore } from "react";
import type { Action, State } from "./types";
import { createInitialState, reducer, STORAGE_KEY } from "./domain/reducer";

let state: State = load();
const listeners = new Set<() => void>();

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (parsed && parsed.version === 1) return parsed;
    }
  } catch {
    // 忽略损坏的本地状态
  }
  return createInitialState();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 浏览器配额不足时仅保留内存态
  }
}

export function dispatch(action: Action) {
  state = reducer(state, action);
  persist();
  listeners.forEach((l) => l());
}

export function getState() {
  return state;
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => selector(state),
    () => selector(state),
  );
}

export { createInitialState };
