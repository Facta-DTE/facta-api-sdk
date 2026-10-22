import { FactaServiceStatus } from "../../../../../react.ts";

// What the API says about itself: a pill for a page, a dot for a point-of-sale header.
// It is public and polls every 60 s, pausing while the tab is hidden.
export function ServiceStatusExample() {
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <FactaServiceStatus />
      <FactaServiceStatus variant="dot" />
    </div>
  );
}
