// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TemplateWarnings } from "../site/components/template-warnings.tsx";

afterEach(cleanup);

describe("TemplateWarnings", () => {
  it("names each refused template and what was used instead", () => {
    render(<TemplateWarnings warnings={[
      { code: "plantilla_no_aplicada", campo: "representacion.plantilla.carta", motivo: "plan", mensaje: "Su plan no incluye esta plantilla." },
      { code: "plantilla_no_aplicada", campo: "representacion.plantilla.ticket", motivo: "incompatible", mensaje: "No sirve para este tipo." },
    ]} />);
    const items = screen.getAllByTestId("template-warning");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("la hoja carta");
    expect(items[0]!.textContent).toContain("requiere plan Lite o Pro");
    expect(items[0]!.textContent).toContain("plantilla de la empresa");
    expect(items[1]!.textContent).toContain("el ticket");
    expect(items[1]!.textContent).toContain("no es compatible con este tipo de documento");
  });

  it("says the choice was used when it was asked for and nothing was refused", () => {
    render(<TemplateWarnings warnings={undefined} requested={{ carta: "carta-menu" }} />);
    expect(screen.getByTestId("template-applied").textContent).toContain("carta-menu");
    expect(screen.queryByTestId("template-warning")).toBeNull();
  });

  it("renders nothing when no template was asked for and nothing was refused", () => {
    const { container } = render(<TemplateWarnings warnings={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
