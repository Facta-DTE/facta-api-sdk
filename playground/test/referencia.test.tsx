// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Referencia } from "../site/sections/referencia/index.tsx";
import { demoCounts, displayNames, guideLinks, statusOf } from "../site/sections/referencia/view.ts";
import { COVERAGE, GROUPS } from "../shared/sdk-coverage.ts";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/referencia");
});

describe("«Referencia del SDK» page", () => {
  it("draws one card per capability, grouped, with the three kinds of status", () => {
    render(<Referencia />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Todo lo que puede hacer el SDK");
    expect(document.querySelectorAll("article.rf-card")).toHaveLength(COVERAGE.length);
    for (const group of GROUPS) expect(screen.getByRole("heading", { level: 2, name: group.label })).toBeTruthy();
    const counts = demoCounts(COVERAGE);
    expect(counts.live + counts.simulated + counts.documented).toBe(COVERAGE.length);
    expect(document.querySelectorAll(".rf-status--documented").length).toBe(counts.documented);
    expect(document.querySelectorAll(".rf-status--simulated").length).toBe(counts.simulated);
  });

  it("finds a capability by an export, an option or an error code, and says how many match", () => {
    render(<Referencia />);
    const search = screen.getByLabelText(/Buscar una capacidad/);
    for (const [term, expected] of [["archivoDteOf", "El Archivo DTE y el JSON original"], ["servedRegion", "Región de la API"], ["return_window_closed", "Evento de Retorno"], ["emergencyStore", "Salvaguarda de emergencia"], ["createCustomer", "Administrar clientes"]] as const) {
      fireEvent.change(search, { target: { value: term } });
      const titles = [...document.querySelectorAll("article.rf-card h3")].map((h) => h.textContent ?? "");
      expect(titles.some((t) => t.includes(expected)), `${term} → ${titles.join(" | ")}`).toBe(true);
    }
    fireEvent.change(search, { target: { value: "zzz-no-existe" } });
    expect(document.querySelectorAll("article.rf-card")).toHaveLength(0);
    expect(screen.getByText(/Ninguna capacidad coincide/)).toBeTruthy();
  });

  it("filters by group and keeps the address in step so a search can be shared", () => {
    render(<Referencia />);
    fireEvent.change(screen.getByLabelText("Grupo"), { target: { value: "retorno" } });
    expect(document.querySelectorAll("article.rf-card")).toHaveLength(COVERAGE.filter((e) => e.group === "retorno").length);
    expect(window.location.search).toBe("?grupo=retorno");
    fireEvent.change(screen.getByLabelText("Grupo"), { target: { value: "todas" } });
    fireEvent.change(screen.getByLabelText(/Buscar una capacidad/), { target: { value: "region" } });
    expect(window.location.search).toBe("?q=region");
  });

  it("shows the reason on a documented-only capability and never offers to run a catalog write", () => {
    render(<Referencia />);
    fireEvent.change(screen.getByLabelText(/Buscar una capacidad/), { target: { value: "createCustomer" } });
    const card = document.getElementById("catalog-write-customers")!;
    expect(within(card).getByText("Solo documentado.")).toBeTruthy();
    expect(card.textContent).toContain("Disponible en el SDK; el playground no modifica el catálogo.");
    expect(card.querySelector("a[href^='/servidor']")).toBeNull();
    // The notice at the top says it too.
    expect(screen.getByRole("note").textContent).toContain("no modifica el");
  });

  it("links a runnable capability to its recipe and loads the code only when asked", () => {
    render(<Referencia />);
    const card = document.getElementById("archivo-dte")!;
    const run = card.querySelector("a.rf-demo-link") as HTMLAnchorElement;
    expect(run.getAttribute("href")).toBe("/servidor?receta=archivo-dte");
    expect(card.querySelector("pre")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Ver el código que se ejecuta" }));
    expect(card.querySelector("pre")!.textContent).toContain("downloadDocument");
    expect(card.querySelector(".pg-code-title")!.textContent).toContain("Ejecutado");
  });

  it("labels a snippet as illustrative", () => {
    render(<Referencia />);
    const card = document.getElementById("holding")!;
    fireEvent.click(within(card).getByRole("button", { name: "Ver un ejemplo de código" }));
    expect(card.querySelector(".pg-code-title")!.textContent).toMatch(/^Ilustrativo/);
  });
});

describe("page helpers", () => {
  it("names a capability's exports the way a person reads them", () => {
    const entry = COVERAGE.find((e) => e.id === "issue")!;
    const names = displayNames(entry);
    expect(names).toContain("facta.issue");
    expect(names).toContain("DteRequest");
    expect(names.some((n) => n.startsWith("mod:"))).toBe(false);
  });

  it("opens the Spanish guide when there is one and the English one otherwise", () => {
    const react = guideLinks(COVERAGE.find((e) => e.id === "react-windows")!).guides[0]!;
    expect(react.href.endsWith("guides/react.md")).toBe(true);
    const archivo = guideLinks(COVERAGE.find((e) => e.id === "archivo-dte")!).guides[0]!;
    expect(archivo.href.endsWith("guides/archivo-dte.es.md")).toBe(true);
  });

  it("gives each demo kind its own status", () => {
    expect(statusOf({ kind: "recipe", recipe: "x" }).label).toBe("Receta en staging");
    expect(statusOf({ kind: "simulated", recipe: "x", note: "n" }).tone).toBe("simulated");
    expect(statusOf({ kind: "documented", reason: "r" }).tone).toBe("documented");
    expect(statusOf({ kind: "page", path: "/", label: "l" }).tone).toBe("live");
  });
});
