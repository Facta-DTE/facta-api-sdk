import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactaReceipt } from "../src/react/index.ts";
import { NO_MOTION, sealed } from "./helpers.tsx";

const ARCHIVO = '{"documento":"del-servidor","firmaElectronica":"h.p.s","selloRecibido":"SEAL"}';

let blobs: Blob[] = [];
const originalCreate = URL.createObjectURL;
const originalClick = HTMLAnchorElement.prototype.click;

beforeEach(() => {
  blobs = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:fake";
  }) as never;
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});
afterEach(() => {
  URL.createObjectURL = originalCreate;
  HTMLAnchorElement.prototype.click = originalClick;
});

describe("the receipt's JSON is the Archivo DTE", () => {
  it("«Descargar JSON» gives archivoDte, not the holding JSON", async () => {
    render(<FactaReceipt result={{ ...sealed, archivoDte: ARCHIVO }} appearance={NO_MOTION} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Descargar JSON" }));
    expect(await blobs[0]!.text()).toBe(ARCHIVO);
  });

  it("builds it from jws + selloRecibido + documento when the API has no archivoDte", async () => {
    const documento = { identificacion: { codigoGeneracion: sealed.codigoGeneracion } };
    render(<FactaReceipt result={{ ...sealed, documento, jws: "h.p.s" } as never} appearance={NO_MOTION} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Descargar JSON" }));
    expect(JSON.parse(await blobs[0]!.text())).toEqual({ ...documento, firmaElectronica: "h.p.s", selloRecibido: sealed.selloRecibido });
  });

  it("the original is offered only when the integrator enables it, and it is the stored file", async () => {
    const { unmount } = render(<FactaReceipt result={{ ...sealed, archivoDte: ARCHIVO }} appearance={NO_MOTION} />);
    expect(screen.queryByRole("button", { name: "JSON original (raw)" })).toBeNull();
    unmount();
    render(<FactaReceipt result={{ ...sealed, archivoDte: ARCHIVO }} rawJson appearance={NO_MOTION} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "JSON original (raw)" }));
    expect(await blobs[0]!.text()).toBe(sealed.archivoJson);
  });

  it("a contingency document keeps its signed JSON and offers no second file", async () => {
    const { archivoDte: _a, representacionGrafica: _p, selloRecibido: _s, ...rest } = sealed;
    render(<FactaReceipt result={{ ...rest, estado: "contingencia", detalle: "x" } as never} rawJson appearance={NO_MOTION} />);
    expect(screen.queryByRole("button", { name: "JSON original (raw)" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Descargar JSON" }));
    expect(await blobs[0]!.text()).toBe(sealed.archivoJson);
  });
});
