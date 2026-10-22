import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, loadState, type PlaygroundState } from "./api.ts";

export type StateView =
  | { status: "loading" }
  | { status: "blocked"; message: string }
  | { status: "ready"; state: PlaygroundState };

interface StateValue {
  view: StateView;
  refresh(): Promise<void>;
}

const StateContext = createContext<StateValue>({ view: { status: "loading" }, refresh: async () => undefined });

export function StateProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<StateView>({ status: "loading" });
  const refresh = useCallback(async () => {
    try {
      setView({ status: "ready", state: await loadState() });
    } catch (error) {
      setView({
        status: "blocked",
        message: error instanceof ApiError ? error.message : "No se pudo conectar con el playground.",
      });
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);
  const value = useMemo(() => ({ view, refresh }), [view, refresh]);
  return <StateContext.Provider value={value}>{children}</StateContext.Provider>;
}

export const usePlayground = () => useContext(StateContext);
