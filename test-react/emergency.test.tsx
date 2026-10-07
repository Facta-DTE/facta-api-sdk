import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FactaReceipt } from "../src/react/index.ts";
import { NO_MOTION, sealed } from "./helpers.tsx";

describe("the emergency banner", () => {
  it("is absent on a normal document", () => {
    render(<FactaReceipt result={sealed} appearance={NO_MOTION} />);
    expect(screen.queryByTestId("facta-emergency")).toBeNull();
  });

  it("says the document went to the emergency backup and keeps the downloads", () => {
    render(<FactaReceipt result={{ ...sealed, emergency: { saved: true, reason: "server_warning" } }} appearance={NO_MOTION} />);
    expect(screen.getByTestId("facta-emergency").textContent).toContain("no quedó en un almacenamiento permanente; se guardó en el respaldo de emergencia");
    expect(screen.getByRole("button", { name: "Descargar JSON" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /PDF/ })).toBeTruthy();
  });

  it("tells the person to download now when nothing was saved", () => {
    render(<FactaReceipt result={{ ...sealed, emergency: { saved: false, reason: "not_configured" } }} appearance={NO_MOTION} />);
    expect(screen.getByTestId("facta-emergency").textContent).toContain("descárguelo ahora");
    expect(screen.getByRole("button", { name: "Descargar JSON" })).toBeTruthy();
  });
});
