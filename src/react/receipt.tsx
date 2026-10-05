import { initialFlowState, type Environment, type IssueResult } from "../browser/index.ts";
import { FactaWindowView } from "./card.tsx";
import { FactaRoot, type FactaLook } from "./look.tsx";

export interface FactaReceiptProps extends FactaLook {
  /** A sealed (or contingency) result you already hold, e.g. from `onIssued`. */
  result: IssueResult;
  /** Shows the «Pruebas» chip for `"00"`. */
  environment?: Environment | null | undefined;
  className?: string | undefined;
}

/** Renders a finished document (past or present) without any network call. */
export function FactaReceipt({ result, environment, className, ...look }: FactaReceiptProps) {
  const state = {
    ...initialFlowState(),
    step: result.estado === "sellado" ? ("sealed" as const) : ("contingency" as const),
    result,
  };
  return (
    <FactaRoot look={look} className={className} state={state.step} run="manual" variant="inline">
      <FactaWindowView state={state} variant="inline" environment={environment ?? null} />
    </FactaRoot>
  );
}
