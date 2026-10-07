import { useState } from "react";
import { useFactaWindow } from "../../../../../react.ts";
import type { WindowExampleProps } from "./types.ts";

// No component in your JSX: `open()` shows the window and resolves with the result
// (or rejects with a `FactaWindowError` when the person closes it without issuing).
export function WindowHookExample({ session, run, autoCloseDelay, autoCloseOn, onIssued }: WindowExampleProps) {
  const { open } = useFactaWindow();
  const [log, setLog] = useState("");
  async function issue() {
    if (session === null) return;
    try {
      const result = await open(session, { variant: "drawer", run, autoCloseDelay, autoCloseOn });
      onIssued(result);
      setLog(`Emitida: ${result.numeroControl}`);
    } catch (error) {
      setLog(`Sin documento: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return (
    <>
      <button type="button" className="pg-primary" disabled={session === null} onClick={issue}>
        useFactaWindow().open()
      </button>
      {log !== "" && <p className="pg-note" role="status">{log}</p>}
    </>
  );
}
