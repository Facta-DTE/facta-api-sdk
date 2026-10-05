import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FactaInvoiceDialog, FactaInvoiceDrawer, FactaInvoiceInline, FactaInvoiceWindow, FactaProvider } from "../src/react/index.ts";
import { envelope, FAST, makeClient, netError, NO_MOTION, sealed, sessionInfo } from "./helpers.tsx";

function Harness(props: {
  client: ReturnType<typeof makeClient>["client"];
  onIssued?: (r: unknown) => void;
  onError?: (e: unknown) => void;
  onEvent?: (e: { type: string }) => void;
  onClose?: () => void;
  run?: "manual" | "auto" | "auto-close";
  autoCloseDelay?: number;
  autoCloseOn?: "success" | "any";
  variant?: "dialog" | "drawer";
  provider?: Record<string, unknown>;
}) {
  const [open, setOpen] = useState(false);
  const Win = props.variant === "drawer" ? FactaInvoiceDrawer : FactaInvoiceDialog;
  return (
    <FactaProvider client={props.client} appearance={NO_MOTION} {...props.provider}>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <Win
        session="tok"
        open={open}
        onOpenChange={setOpen}
        run={props.run}
        autoCloseDelay={props.autoCloseDelay}
        autoCloseOn={props.autoCloseOn}
        onIssued={props.onIssued}
        onError={props.onError}
        onEvent={props.onEvent as never}
        onClose={props.onClose}
        flowOptions={FAST}
      />
    </FactaProvider>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  return user;
}

describe("dialog: review", () => {
  it("shows a labelled modal with the draft, the implementer's total and the attribution", async () => {
    const { client } = makeClient({});
    render(<Harness client={client} />);
    await openDialog();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = await within(dialog).findByRole("heading", { name: "Revise su factura" });
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(within(dialog).getByText("Factura")).toBeTruthy();
    expect(within(dialog).getByText("María López")).toBeTruthy();
    expect(within(dialog).getByText("Café de altura 1 lb")).toBeTruthy();
    expect(within(dialog).getByText("2 × $8.50")).toBeTruthy();
    expect(within(dialog).getByText("$17.00")).toBeTruthy();
    expect(within(dialog).getByText("Total de su pedido")).toBeTruthy();
    expect(within(dialog).getByText("$22.00")).toBeTruthy();
    expect(within(dialog).getByText(/Hacienda calcula los totales definitivos/)).toBeTruthy();
    expect(within(dialog).getByText("Pruebas")).toBeTruthy();
    expect(within(dialog).getByText("Powered by factadte.com")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Emitir factura" })).toBeTruthy();
  });

  it("says «Consumidor final» without a receiver and omits the chip in production", async () => {
    const { client } = makeClient({
      describe: sessionInfo({ environment: "01", draft: { tipoDte: "03", items: [{ descripcion: "x", cantidad: 1, precioUni: 1 }] }, display: {} }),
    });
    render(<Harness client={client} />);
    await openDialog();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Consumidor final");
    expect(within(dialog).getByText("Crédito fiscal")).toBeTruthy();
    expect(within(dialog).queryByText("Pruebas")).toBeNull();
  });

  it("shows a skeleton while loading", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client } = makeClient({});
    const original = client.describe;
    client.describe = async (s) => {
      await gate;
      return original(s);
    };
    render(<Harness client={client} />);
    await openDialog();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector(".facta-skeleton")).toBeTruthy();
    expect(within(dialog).getByRole("heading").textContent).toBe("Cargando su factura");
    await act(async () => release());
    await within(dialog).findByText("Revise su factura");
  });
});

describe("dialog: issuing to a result", () => {
  it("goes review -> sealed with identifiers, copy and downloads, and «Listo» closes", async () => {
    const { client } = makeClient({ issue: [sealed] });
    const onIssued = vi.fn();
    const onClose = vi.fn();
    const onEvent = vi.fn();
    const createObjectURL = vi.fn(() => "blob:fake");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL: revoke });
    const clicks: string[] = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicks.push(this.download);
    };
    render(<Harness client={client} onIssued={onIssued} onClose={onClose} onEvent={onEvent} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Total emitido");
    expect(within(dialog).getByRole("heading", { name: "Factura emitida" })).toBeTruthy();
    expect(within(dialog).getByText("$1,234.56")).toBeTruthy();
    expect(within(dialog).getByText(sealed.numeroControl)).toBeTruthy();
    expect(within(dialog).getByText(sealed.codigoGeneracion)).toBeTruthy();
    expect(within(dialog).getByText("05/10/2026 14:32")).toBeTruthy();
    expect(within(dialog).getByText("Guardadas")).toBeTruthy();
    expect(onIssued).toHaveBeenCalledWith(expect.objectContaining({ numeroControl: sealed.numeroControl }));
    expect(onEvent.mock.calls.map((c) => c[0].type)).toEqual(["opened", "issuing", "sealed"]);

    await user.click(within(dialog).getByRole("button", { name: "Descargar PDF" }));
    await user.click(within(dialog).getByRole("button", { name: "Descargar JSON" }));
    expect(clicks).toEqual([`${sealed.codigoGeneracion}.pdf`, `${sealed.codigoGeneracion}.json`]);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    HTMLAnchorElement.prototype.click = click;

    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(within(dialog).getByRole("button", { name: "Copiar Número de control" }));
    expect(writeText).toHaveBeenCalledWith(sealed.numeroControl);
    await within(dialog).findAllByText("Copiado");

    await user.click(within(dialog).getByRole("button", { name: "Listo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalled();
    expect(onEvent.mock.calls.at(-1)![0].type).toBe("closed");
  });

  it("hides the download buttons when the server sent no files", async () => {
    const { client } = makeClient({ issue: [(({ archivoJson: _j, ...r }) => ({ ...r, representacionGrafica: null }))(sealed)] });
    render(<Harness client={client} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    await screen.findByText("Total emitido");
    expect(screen.queryByRole("button", { name: "Descargar PDF" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Descargar JSON" })).toBeNull();
  });

  it("shows the three-step progress with aria-live while a call is pending, and no close", async () => {
    let release!: (v: typeof sealed) => void;
    const pending = new Promise<typeof sealed>((r) => (release = r));
    const { client } = makeClient({ issue: [pending] });
    render(<Harness client={client} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Preparando el documento")).toBeTruthy();
    expect(within(dialog).getByText("Firmando")).toBeTruthy();
    expect(within(dialog).getByText("Enviando a Hacienda")).toBeTruthy();
    expect(within(dialog).getAllByRole("status").some((n) => /Paso 1 de 3/.test(n.textContent ?? ""))).toBe(true);
    expect(within(dialog).queryByRole("button", { name: "Cerrar ventana" })).toBeNull();
    expect(within(dialog).queryByRole("button")).toBeNull();
    await act(async () => release(sealed));
    await within(dialog).findByText("Total emitido");
  });

  it("renders contingency as a warning success with the explanation", async () => {
    const { client } = makeClient({ issue: [(({ selloRecibido: _s, ...r }) => ({ ...r, estado: "contingencia" as const, detalle: "Hacienda sin servicio", representacionGrafica: null }))(sealed)] });
    const onIssued = vi.fn();
    render(<Harness client={client} onIssued={onIssued} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Factura firmada, pendiente de Hacienda");
    expect(within(dialog).getByText(/No vuelva a emitir este documento/)).toBeTruthy();
    expect(within(dialog).getByText("Hacienda sin servicio")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Descargar JSON" })).toBeTruthy();
    expect(onIssued).toHaveBeenCalled();
  });
});

describe("dialog: failures are read-only and helpful", () => {
  it("rejection quotes Hacienda verbatim, lists readable fields, mentions the spent number, no retry", async () => {
    const { client } = makeClient({
      issue: [envelope("mh_rejected", {
        observaciones: ["[receptor.nrc] El valor no cumple el formato"],
        spent: { codigoGeneracion: "CG", numeroControl: "DTE-01-M001P001-000000000000043" },
        fields: [{ path: "receptor.nrc", message: "formato inválido" }, { path: "items[2].precioUni", message: "debe ser mayor que 0" }],
      })],
    });
    const onError = vi.fn();
    render(<Harness client={client} onError={onError} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("heading", { name: "Hacienda rechazó el documento" });
    expect(within(dialog).getByText("[receptor.nrc] El valor no cumple el formato")).toBeTruthy();
    expect(within(dialog).getByText("NRC del receptor")).toBeTruthy();
    expect(within(dialog).getByText("Precio de la línea 3")).toBeTruthy();
    expect(within(dialog).getByText(/Este rechazo usó el número de control DTE-01-M001P001-000000000000043. Al corregir el documento en su sistema, puede volver a usar ese mismo número/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Intentar de nuevo" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Corregir/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cerrar" })).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "mh_rejected", fields: expect.any(Array) }));
  });

  it("offers «Intentar de nuevo» only when retryable and nothing was spent, and retry works", async () => {
    const { client, issue } = makeClient({ issue: [envelope("rate_limited", { status: 429, retryable: true }), sealed] });
    render(<Harness client={client} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("No se pudo emitir");
    expect(within(dialog).getByText(/demasiadas solicitudes/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Intentar de nuevo" }));
    await within(dialog).findByText("Total emitido");
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it("a non-retryable failure shows only «Cerrar»", async () => {
    const { client } = makeClient({ issue: [envelope("validation_failed", { status: 422, retryable: false })] });
    render(<Harness client={client} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("No se pudo emitir");
    expect(within(dialog).queryByRole("button", { name: "Intentar de nuevo" })).toBeNull();
    expect(within(dialog).getByText("validation_failed")).toBeTruthy();
  });

  it("an uncertain outcome verifies with the same session and never offers a fresh retry", async () => {
    const { client, calls } = makeClient({ issue: [netError(), netError(), netError()] });
    render(<Harness client={client} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("No pudimos confirmar el resultado");
    expect(calls.filter((c) => c === "issue")).toHaveLength(3);
    expect(within(dialog).queryByRole("button", { name: "Intentar de nuevo" })).toBeNull();
    expect(within(dialog).getByText(/No vuelva a emitir este documento/)).toBeTruthy();
  });

  it("an uncertain outcome that resolves shows the sealed screen", async () => {
    const { client } = makeClient({ issue: [netError(), sealed] });
    render(<Harness client={client} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    await screen.findByText("Total emitido");
  });

  it("shows the expired screen with only «Cerrar»", async () => {
    const { client } = makeClient({ describe: envelope("session_expired", { status: 401 }) });
    render(<Harness client={client} />);
    await openDialog();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Esta ventana venció.");
    expect(within(dialog).getByText("Vuelva a abrirla desde su pedido.")).toBeTruthy();
  });
});

describe("dialog: keyboard and focus", () => {
  it("Esc closes from review but not while submitting or verifying", async () => {
    let release!: (v: typeof sealed) => void;
    const pending = new Promise<typeof sealed>((r) => (release = r));
    const { client } = makeClient({ issue: [pending] });
    render(<Harness client={client} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => release(sealed));
    await screen.findByText("Total emitido");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc closes the review step and focus returns to the opener", async () => {
    const { client } = makeClient({});
    render(<Harness client={client} />);
    const user = await openDialog();
    const opener = screen.getByRole("button", { name: "Abrir" });
    await screen.findByRole("button", { name: "Emitir factura" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("traps Tab inside the dialog", async () => {
    const { client } = makeClient({});
    render(<Harness client={client} />);
    const user = await openDialog();
    const dialog = await screen.findByRole("dialog");
    await screen.findByRole("button", { name: "Emitir factura" });
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 4; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("the close button is 44px-addressable and closes", async () => {
    const { client } = makeClient({});
    render(<Harness client={client} />);
    const user = await openDialog();
    await screen.findByRole("button", { name: "Emitir factura" });
    await user.click(screen.getByRole("button", { name: "Cerrar ventana" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("modes and looks", () => {
  it("run=auto issues immediately without the review screen", async () => {
    const { client, calls } = makeClient({ issue: [sealed] });
    render(<Harness client={client} run="auto" />);
    await openDialog();
    await screen.findByText("Total emitido");
    expect(calls).toEqual(["describe", "issue"]);
    expect(screen.queryByRole("button", { name: "Emitir factura" })).toBeNull();
  });

  it("attribution:false removes «Powered by factadte.com»; branding name shows in the header", async () => {
    const { client } = makeClient({});
    render(<Harness client={client} provider={{ branding: { name: "Café del Volcán", attribution: false } }} />);
    await openDialog();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Café del Volcán");
    expect(within(dialog).queryByText("Powered by factadte.com")).toBeNull();
  });

  it("appearance variables become --facta-* custom properties; classNames and unstyled work", async () => {
    const { client } = makeClient({});
    render(
      <Harness
        client={client}
        provider={{
          appearance: { motion: "none", theme: "dark", density: "compact", variables: { accent: "#7a3cff", radius: "20px", fontFamily: "Georgia" } },
          classNames: { primaryButton: "mi-boton" },
        }}
      />,
    );
    await openDialog();
    const dialog = await screen.findByRole("dialog");
    const root = dialog.closest(".facta-root") as HTMLElement;
    expect(root.style.getPropertyValue("--facta-accent")).toBe("#7a3cff");
    expect(root.style.getPropertyValue("--facta-radius")).toBe("20px");
    expect(root.style.getPropertyValue("--facta-font")).toBe("Georgia");
    expect(root.getAttribute("data-facta-theme")).toBe("dark");
    expect(root.getAttribute("data-facta-density")).toBe("compact");
    expect(root.getAttribute("data-facta-motion")).toBe("none");
    const primary = await screen.findByRole("button", { name: "Emitir factura" });
    expect(primary.className).toContain("mi-boton");
    expect(primary.className).toContain("facta-btn");
  });

  it("unstyled drops default facta- classes but keeps host classes", async () => {
    const { client } = makeClient({});
    render(<Harness client={client} provider={{ unstyled: true, classNames: { primaryButton: "mine" } }} />);
    await openDialog();
    const primary = await screen.findByRole("button", { name: "Emitir factura" });
    expect(primary.className).toBe("mine");
  });

  it("messages can be overridden partially", async () => {
    const { client } = makeClient({});
    render(<Harness client={client} provider={{ messages: { review: { issue: "Pagar y emitir" } } }} />);
    await openDialog();
    await screen.findByRole("button", { name: "Pagar y emitir" });
    expect(screen.getByText("Revise su factura")).toBeTruthy();
  });

  it("the provider-level onEvent hears the window", async () => {
    const { client } = makeClient({ issue: [sealed] });
    const onEvent = vi.fn();
    render(<Harness client={client} provider={{ onEvent }} />);
    const user = await openDialog();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    await screen.findByText("Total emitido");
    expect(onEvent.mock.calls.map((c) => c[0].type)).toContain("sealed");
  });
});

describe("other presentations", () => {
  it("drawer is a labelled modal with the same screens", async () => {
    const { client } = makeClient({ issue: [sealed] });
    render(<Harness client={client} variant="drawer" />);
    const user = await openDialog();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.closest(".facta-layer--drawer")).toBeTruthy();
    await user.click(await within(dialog).findByRole("button", { name: "Emitir factura" }));
    await within(dialog).findByText("Total emitido");
  });

  it("inline renders in the page flow: no dialog role, no close without onClose", async () => {
    const { client } = makeClient({ issue: [sealed] });
    const { container } = render(
      <FactaProvider client={client} appearance={NO_MOTION}>
        <p>Gracias por su compra</p>
        <FactaInvoiceInline session="tok" flowOptions={FAST} />
      </FactaProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Emitir factura" }));
    await screen.findByText("Total emitido");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cerrar ventana" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Listo" })).toBeNull();
    expect(container.querySelector(".facta-inline")).toBeTruthy();
  });

  it("FactaInvoiceWindow picks the presentation", async () => {
    const { client } = makeClient({});
    render(
      <FactaProvider client={client} appearance={NO_MOTION}>
        <FactaInvoiceWindow session="tok" open presentation="inline" flowOptions={FAST} />
      </FactaProvider>,
    );
    await screen.findByRole("button", { name: "Emitir factura" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
