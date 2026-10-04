import { safeFailureCode } from "./live-report.mjs";

/** Full live validation requires owner-published snapshots before fiscal work. */
export async function requireLiveSnapshots(facta, checks, onCheck = (_check) => {}, managedOnlyReady = false) {
  for (const [check, method] of [["catalog", "syncCatalog"], ["destinations", "syncDestinations"]]) {
    if (check === "destinations" && managedOnlyReady) { checks[check] = "Not applicable (managed only)"; continue; }
    onCheck(check);
    try {
      // Discard decrypted contents; only the capability result may be reported.
      await facta[method]();
      checks[check] = "Passed";
    } catch (cause) {
      checks[check] = "Failed";
      const error = new Error("Required snapshot is unavailable for full live validation.");
      error.code = safeFailureCode(cause);
      throw error;
    }
  }
}
