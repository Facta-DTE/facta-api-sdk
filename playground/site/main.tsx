import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/react/styles.css";
import "./styles.css";
import { App } from "./app.tsx";

async function boot() {
  // `?mock=1` replaces the Worker with an in-browser fake, in `vite` development only.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("mock") === "1") {
    (await import("./mock.ts")).installDevMock(window.location.search);
  }
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
}

void boot();
