import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  FactaIssueButton,
  FactaProvider,
  FactaReceipt,
  FactaStatusBadge,
  FactaWindowError,
  useFactaIssue,
  useFactaWindow,
} from "../src/react/index.ts";
import { envelope, FAST, makeClient, NO_MOTION, sealed } from "./helpers.tsx";

describe("FactaIssueButton", () => {
  it("morphs from label to phase to «Emitida» and opens a result popover", async () => {
    let release!: (v: typeof sealed) => void;
    const pending = new Promise<typeof sealed>((r) => (release = r));
    const { client } = makeClient({ issue: [pending] });
    const onIssued = vi.fn();
    render(
      <FactaProvider client={client} appearance={NO_MOTION}>
        <FactaIssueButton session="tok" onIssued={onIssued} flowOptions={FAST} />
      </FactaProvider>,
    );
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Emitir factura" });
    expect(button.getAttribute("data-kind")).toBe("idle");
    await user.click(button);
    await waitFor(() => expect(screen.getByRole("button").getAttribute("data-kind")).toBe("working"));
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button").textContent).toContain("Preparando el documento");
    release(sealed);
    await waitFor(() => expect(screen.getByRole("button").getAttribute("data-kind")).toBe("done"));
    expect(screen.getByRole("button").textContent).toContain("Emitida");
    expect(onIssued).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Emitida/ }));
    const popover = await screen.findByRole("dialog");
    expect(within(popover).getByText("$1,234.56")).toBeTruthy();
    expect(within(popover).getByRole("button", { name: "Descargar PDF" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("errors turn the button red and open the explanation, with retry only when allowed", async () => {
    const { client, issue } = makeClient({ issue: [envelope("rate_limited", { status: 429, retryable: true }), sealed] });
    render(
      <FactaProvider client={client} appearance={NO_MOTION}>
        <FactaIssueButton session="tok" flowOptions={FAST} />
      </FactaProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Emitir factura" }));
    const popover = await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: /No se emitió/ }).getAttribute("data-kind")).toBe("failed");
    expect(within(popover).getByText(/demasiadas solicitudes/)).toBeTruthy();
    await user.click(within(popover).getByRole("button", { name: "Intentar de nuevo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Emitida/ })).toBeTruthy());
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it("confirm=true opens the dialog first", async () => {
    const { client } = makeClient({ issue: [sealed] });
    render(
      <FactaProvider client={client} appearance={NO_MOTION}>
        <FactaIssueButton session="tok" confirm flowOptions={FAST} />
      </FactaProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Emitir factura" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Emitir factura" }));
    await within(dialog).findByText("Total a pagar");
  });
});

describe("FactaReceipt and FactaStatusBadge", () => {
  it("renders a stored document with no provider and no network", () => {
    render(<FactaReceipt result={sealed} environment="00" appearance={NO_MOTION} />);
    expect(screen.getByText("Factura emitida")).toBeTruthy();
    expect(screen.getByText("$1,234.56")).toBeTruthy();
    expect(screen.getByText("Pruebas")).toBeTruthy();
    expect(screen.getByText(sealed.numeroControl)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Listo" })).toBeNull();
  });

  it("shows the storage row quietly: pending is not an error, off is neutral, showStorage hides it", () => {
    const { rerender } = render(<FactaReceipt result={{ ...sealed, storage: { managed: "pending", archive: "partial" } }} />);
    expect(screen.getByText("Guardándose…")).toBeTruthy();
    expect(screen.getByText(/no afecta la validez de la factura/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(<FactaReceipt result={{ ...sealed, storage: { managed: "not_configured", archive: "off" } }} />);
    expect(screen.getByText("Sin copia automática")).toBeTruthy();
    rerender(<FactaReceipt result={{ ...sealed, storage: { managed: "not_configured", archive: "off" } }} showStorage={false} />);
    expect(screen.queryByText("Sin copia automática")).toBeNull();
    rerender(<FactaReceipt result={(({ storage: _s, ...rest }) => rest)(sealed)} />);
    expect(screen.queryByText("Copias")).toBeNull();
  });

  it("badge labels the status with a tone", () => {
    render(<FactaStatusBadge estado="sellado" />);
    const badge = screen.getByText("Sellado");
    expect(badge.className).toContain("facta-badge--success");
    render(<FactaStatusBadge estado="rechazado" />);
    expect(screen.getByText("Rechazado").className).toContain("facta-badge--danger");
  });
});

describe("headless hook and imperative window", () => {
  function Headless() {
    const { state, next } = useFactaIssue("tok", { flowOptions: FAST });
    return (
      <div>
        <span data-testid="step">{state.step}</span>
        <button onClick={next}>go</button>
      </div>
    );
  }

  it("useFactaIssue exposes the state machine", async () => {
    const { client } = makeClient({ issue: [sealed] });
    render(<FactaProvider client={client}><Headless /></FactaProvider>);
    await waitFor(() => expect(screen.getByTestId("step").textContent).toBe("review"));
    await userEvent.setup().click(screen.getByText("go"));
    await waitFor(() => expect(screen.getByTestId("step").textContent).toBe("sealed"));
  });

  function Imperative({ onDone }: { onDone: (v: unknown) => void }) {
    const { open } = useFactaWindow();
    return (
      <button onClick={() => open("tok").then(onDone, onDone)}>pagar</button>
    );
  }

  it("useFactaWindow().open resolves with the issued document", async () => {
    const { client } = makeClient({ issue: [sealed] });
    const done = vi.fn();
    render(<FactaProvider client={client} appearance={NO_MOTION}><Imperative onDone={done} /></FactaProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByText("pagar"));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Emitir factura" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(done.mock.calls[0]![0]).toMatchObject({ numeroControl: sealed.numeroControl });
  });

  it("rejects with FactaWindowError when closed without a document", async () => {
    const { client } = makeClient({});
    const done = vi.fn();
    render(<FactaProvider client={client} appearance={NO_MOTION}><Imperative onDone={done} /></FactaProvider>);
    const user = userEvent.setup();
    await user.click(screen.getByText("pagar"));
    await screen.findByRole("button", { name: "Emitir factura" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(done.mock.calls[0]![0]).toBeInstanceOf(FactaWindowError);
    expect((done.mock.calls[0]![0] as FactaWindowError).code).toBe("closed");
  });
});
