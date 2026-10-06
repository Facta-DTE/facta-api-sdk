import type { AutoCloseOn, IssueResult, RunMode } from "../../../../../react.ts";

/** What every issuing example receives from the page. */
export interface WindowExampleProps {
  /** The session token the server made for the prepared sale; null until a sale is prepared. */
  session: string | null;
  run: RunMode;
  autoCloseDelay: number;
  autoCloseOn: AutoCloseOn;
  onIssued: (result: IssueResult) => void;
}
