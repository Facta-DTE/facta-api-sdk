import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryView, FactaClient } from "../src/browser/index.ts";
import { FactaInvoiceInline, FactaIssueButton, FactaProvider, FactaReceipt } from "../src/react/index.ts";
import { envelope, makeClient, NO_MOTION, sealed, sessionInfo } from "./helpers.tsx";

const view = (canales: DeliveryView["canales"]): DeliveryView => ({ canales });

/** A sleep the test releases by hand, so «Enviando…» can be observed. */
function gate() {
  const waiting: Array<() => void> = [];
  return {
    sleep: () => new Promise<void>((resolve) => waiting.push(resolve)),
    release: async () => {
      const batch = waiting.splice(0);
      await act(async () => { batch.forEach((r) => r()); });
    },
    pending: () => waiting.length,
  };
}

function clientWith(initial: DeliveryView, reads: Array<DeliveryView | Error>) {
  const base = makeClient({ describe: sessionInfo(), issue: [{ ...sealed, deliveryHandle: "h.mac", delivery: initial }] });
  const deliveryStatus = vi.fn(async () => {
    const next = reads.shift();
    if (next === undefined) throw envelope("action_not_allowed", { status: 403 });
    if (next instanceof Error) throw next;
    return next;
  });
  const client: FactaClient = { ...base.client, deliveryStatus };
  return { client, deliveryStatus };
}

function renderInline(client: FactaClient, extra: Record<string, unknown> = {}, sleep?: () => Promise<void>) {
  return render(
    <FactaProvider client={client} appearance={NO_MOTION}>
      <FactaInvoiceInline
        session="tok"
        run="auto"
        flowOptions={{ verifyDelayMs: 0, phaseDelaysMs: [60_000, 120_000], ...(sleep ? { sleep } : {}) }}
        {...extra}
      />
    </FactaProvider>,
  );
}

const PENDING = view({ correo: { estado: "pendiente", destino: "m•••@ejemplo.com" } });

describe("delivery rows", () => {
  it("shows «Enviando correo…» without blocking «Listo», then the masked address", async () => {
    const g = gate();
    const { client } = clientWith(PENDING, [view({ correo: { estado: "enviado", destino: "m•••@ejemplo.com" } })]);
    const onClose = vi.fn();
    const onIssued = vi.fn();
    const onDelivery = vi.fn();
    renderInline(client, { onClose, onIssued, onDelivery }, g.sleep);
    await screen.findByText("Enviando correo…");
    expect(screen.getByText("Entrega por correo")).toBeTruthy();
    // The fiscal result is on screen and closable while delivery is still running.
    expect(onIssued).toHaveBeenCalledTimes(1);
    const done = screen.getByRole("button", { name: "Listo" });
    expect((done as HTMLButtonElement).disabled).toBe(false);
    await userEvent.setup().click(done);
    expect(onClose).toHaveBeenCalled();

    await g.release();
    await screen.findByText("Correo enviado a m•••@ejemplo.com");
    expect(onIssued).toHaveBeenCalledTimes(1); // delivery updates never re-fire onIssued
    expect(onDelivery.mock.calls.map(([d]) => d.canales.correo.estado)).toEqual(["pendiente", "enviado"]);
  });

  it("auto-close does not wait for delivery, and onDelivery still reports the final state", async () => {
    const g = gate();
    const { client } = clientWith(PENDING, [view({ correo: { estado: "enviado", destino: "m•••@ejemplo.com" } })]);
    const onClose = vi.fn();
    const onDelivery = vi.fn();
    const { unmount } = renderInline(client, { run: "auto-close", autoCloseDelay: 0, onClose, onDelivery }, g.sleep);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDelivery).toHaveBeenCalledTimes(1); // still «pendiente»
    unmount(); // the host removes the window on close
    await g.release();
    await waitFor(() => expect(onDelivery).toHaveBeenCalledTimes(2));
    expect(onDelivery.mock.calls[1]![0].canales.correo.estado).toBe("enviado");
  });

  it("explains each WhatsApp state in words", async () => {
    const cases: Array<[string, string | null, RegExp]> = [
      ["sin_credito", "wallet_empty", /Sin saldo de WhatsApp/],
      ["sin_consentimiento", null, /Sin consentimiento del cliente/],
      ["no_permitido", null, /El permiso de la llave no incluye WhatsApp/],
      ["vencido", null, /El plazo para enviar venció/],
    ];
    for (const [estado, motivo, text] of cases) {
      const { client } = clientWith(view({ whatsapp: { estado: estado as never, motivo, destino: "+503 •••• 0000" } }), []);
      const { unmount } = renderInline(client);
      const row = await screen.findByText(text);
      expect(row.closest("[data-facta-slot='deliveryRow']")?.getAttribute("data-state")).toBe(estado);
      unmount();
    }
  });

  it("explains a failed e-mail with a readable reason", async () => {
    const { client } = clientWith(view({ correo: { estado: "fallido", motivo: "invalid_address" } }), []);
    renderInline(client);
    await screen.findByText("No se pudo enviar el correo");
    await screen.findByText("Dirección rechazada");
  });

  it("shows only the marked channels, e-mail first", async () => {
    const { client } = clientWith(view({
      whatsapp: { estado: "enviado", destino: "+503 •••• 0000" },
      correo: { estado: "enviado", destino: "m•••@ejemplo.com" },
    }), []);
    renderInline(client);
    await screen.findByText("Correo enviado a m•••@ejemplo.com");
    const rows = document.querySelectorAll("[data-facta-slot='deliveryRow']");
    expect([...rows].map((r) => r.getAttribute("data-channel"))).toEqual(["correo", "whatsapp"]);
  });

  it("says it will check later when the polling budget ends, keeping the document sealed", async () => {
    const { client, deliveryStatus } = clientWith(PENDING, [
      view({ correo: { estado: "en_proceso" } }),
      view({ correo: { estado: "en_proceso" } }),
    ]);
    renderInline(client, { flowOptions: { verifyDelayMs: 0, sleep: () => Promise.resolve(), deliveryIntervalMs: 2000, deliveryTimeoutMs: 4000 } });
    await screen.findByText("Consultaremos el estado más tarde");
    expect(deliveryStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: /Descargar PDF/ })).toBeTruthy();
  });

  it("stops polling once every channel is final", async () => {
    const { client, deliveryStatus } = clientWith(PENDING, [view({ correo: { estado: "enviado", destino: "m•••@ejemplo.com" } })]);
    renderInline(client, { flowOptions: { verifyDelayMs: 0, sleep: () => Promise.resolve() } });
    await screen.findByText("Correo enviado a m•••@ejemplo.com");
    await new Promise((r) => setTimeout(r, 20));
    expect(deliveryStatus).toHaveBeenCalledTimes(1);
  });

  it("exposes the slot: data-facta-slot and the deliveryRow class name", async () => {
    const { client } = clientWith(view({ correo: { estado: "enviado", destino: "m•••@ejemplo.com" } }), []);
    renderInline(client, { classNames: { deliveryRow: "mi-fila-entrega" } });
    const row = (await screen.findByText("Correo enviado a m•••@ejemplo.com")).closest("[data-facta-slot='deliveryRow']")!;
    expect(row.classList.contains("mi-fila-entrega")).toBe(true);
  });

  it("renders nothing for a result that never marked a channel", async () => {
    const { client } = makeClient({ issue: [sealed] });
    renderInline(client);
    await screen.findByRole("button", { name: /Descargar PDF/ });
    expect(document.querySelector("[data-facta-slot='deliveryRow']")).toBeNull();
  });
});

describe("delivery rows elsewhere", () => {
  it("FactaReceipt draws the rows from a result it already holds", () => {
    render(
      <FactaReceipt
        result={{ ...sealed, delivery: view({ correo: { estado: "enviado", destino: "m•••@ejemplo.com" }, whatsapp: { estado: "sin_credito" } }) }}
        appearance={NO_MOTION}
      />,
    );
    expect(screen.getByText("Correo enviado a m•••@ejemplo.com")).toBeTruthy();
    expect(screen.getByText("Sin saldo de WhatsApp")).toBeTruthy();
  });

  it("the issue button's popover shows the rows", async () => {
    const { client } = clientWith(view({ correo: { estado: "enviado", destino: "m•••@ejemplo.com" } }), []);
    render(
      <FactaProvider client={client} appearance={NO_MOTION}>
        <FactaIssueButton session="tok" flowOptions={{ verifyDelayMs: 0, sleep: () => Promise.resolve() }} />
      </FactaProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Emitir factura" }));
    await waitFor(() => expect(screen.getByRole("button").getAttribute("data-kind")).toBe("done"));
    await user.click(screen.getByRole("button", { name: /Emitida/ }));
    const popover = await screen.findByRole("dialog");
    expect(within(popover).getByText("Correo enviado a m•••@ejemplo.com")).toBeTruthy();
  });
});
