import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AutoCloseOn, IssueResult, RunMode } from "../../../../react.ts";
import { loadIssued, type CreatedSession, type IssuedDocument } from "../../api.ts";
import { usePlayground } from "../../state.tsx";

/** What every example of the page shares: the prepared sale, the run mode and the last result. */
interface ScreenState {
  prepared: (CreatedSession & { tipoDte: string }) | null;
  setPrepared(value: (CreatedSession & { tipoDte: string }) | null): void;
  run: RunMode;
  setRun(value: RunMode): void;
  autoCloseDelay: number;
  setAutoCloseDelay(value: number): void;
  autoCloseOn: AutoCloseOn;
  setAutoCloseOn(value: AutoCloseOn): void;
  /** The last document sealed (or put in contingency) by any window on the page. */
  last: IssueResult | null;
  /** Call from every window's `onIssued`. */
  onIssued(result: IssueResult): void;
  /** What this visitor issued here, from the server's ledger. */
  issued: IssuedDocument[];
  refreshIssued(): Promise<void>;
}

const Context = createContext<ScreenState | null>(null);

export function ScreenStateProvider({ children }: { children: ReactNode }) {
  const { view, refresh } = usePlayground();
  const signedIn = view.status === "ready" && view.state.visitor !== null;
  const [prepared, setPrepared] = useState<ScreenState["prepared"]>(null);
  const [run, setRun] = useState<RunMode>("manual");
  const [autoCloseDelay, setAutoCloseDelay] = useState(1200);
  const [autoCloseOn, setAutoCloseOn] = useState<AutoCloseOn>("success");
  const [last, setLast] = useState<IssueResult | null>(null);
  const [issued, setIssued] = useState<IssuedDocument[]>([]);

  const refreshIssued = useCallback(async () => {
    try {
      setIssued(await loadIssued());
    } catch {
      setIssued([]);
    }
  }, []);
  useEffect(() => {
    if (signedIn) void refreshIssued();
  }, [signedIn, refreshIssued]);

  const onIssued = useCallback((result: IssueResult) => {
    setLast(result);
    void refreshIssued();
    void refresh(); // the quota
  }, [refreshIssued, refresh]);

  const value = useMemo<ScreenState>(() => ({
    prepared, setPrepared, run, setRun, autoCloseDelay, setAutoCloseDelay, autoCloseOn, setAutoCloseOn, last, onIssued, issued, refreshIssued,
  }), [prepared, run, autoCloseDelay, autoCloseOn, last, onIssued, issued, refreshIssued]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useScreens(): ScreenState {
  const value = useContext(Context);
  if (value === null) throw new Error("useScreens needs ScreenStateProvider");
  return value;
}
