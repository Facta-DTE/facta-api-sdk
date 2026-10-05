import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactaInvoiceDialog, FactaProvider, useFactaWindow, type FactaLayerProps } from "../src/react/index.ts";
import { envelope, FAST, makeClient, NO_MOTION, sealed } from "./helpers.tsx";

function Harness(props: { client: ReturnType<typeof makeClient>["client"] } & Partial<FactaLayerProps>) {
  const { client, ...rest } = props;
  const [open, setOpen] = useState(false);
  return (
    <FactaProvider client={client} appearance={NO_MOTION}>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <FactaInvoiceDialog session="tok" open={open} onOpenChange={setOpen} flowOptions={FAST} {...rest} />
    </FactaProvider>
  );
}

describe("run = auto", () => {
  it("issues without a click and leaves the result open until closed", async () => {
    const { client, calls } = makeClient({ issue: [sealed] });
    render(<Harness client={client} run="auto" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Abrir" }));
    await screen.findByText("Total emitido");
    expect(calls).toEqual(["describe", "issue"]);
    expect(screen.queryByRole("button", { name: "Emitir factura" })).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText(/Se cerrará en/)).toBeNull();
  });
});

describe("run = auto-close", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const openIt = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await flush(0);
    await flush(0);
  };

  it("shows the countdown, calls onIssued first and closes after the delay", async () => {
    const { client } = makeClient({ issue: [sealed] });
    const order: string[] = [];
    render(
      <Harness
        client={client}
        run="auto-close"
        autoCloseDelay={1200}
        onIssued={() => order.push("issued")}
        onClose={() => order.push("closed")}
      />,
    );
    await openIt();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Total emitido")).toBeTruthy();
    expect(within(dialog).getByText("Se cerrará en 2 s")).toBeTruthy();
    await flush(1100);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    await flush(200);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(order).toEqual(["issued", "closed"]);
  });

  it("autoCloseDelay 0 closes at once", async () => {
    const { client } = makeClient({ issue: [sealed] });
    render(<Harness client={client} run="auto-close" autoCloseDelay={0} />);
    await openIt();
    await flush(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("any pointer, key or focus interaction cancels it and keeps the result actions", async () => {
    const { client } = makeClient({ issue: [sealed] });
    render(<Harness client={client} run="auto-close" autoCloseDelay={1200} />);
    await openIt();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Se cerrará en/)).toBeTruthy();
    fireEvent.pointerDown(within(dialog).getByRole("button", { name: "Descargar JSON" }));
    await flush(5000);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(screen.queryByText(/Se cerrará en/)).toBeNull();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Listo" })).toBeTruthy();
  });

  it("a rejection stays open with autoCloseOn=success", async () => {
    const { client } = makeClient({ issue: [envelope("mh_rejected", { observaciones: ["x"], spent: { numeroControl: "DTE-01-M001P001-000000000000043" } })] });
    render(<Harness client={client} run="auto-close" autoCloseDelay={500} />);
    await openIt();
    await flush(5000);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Hacienda rechazó el documento")).toBeTruthy();
    expect(screen.queryByText(/Se cerrará en/)).toBeNull();
  });

  it("a rejection closes with autoCloseOn=any", async () => {
    const { client } = makeClient({ issue: [envelope("mh_rejected", { observaciones: ["x"] })] });
    const onError = vi.fn();
    render(<Harness client={client} run="auto-close" autoCloseOn="any" autoCloseDelay={500} onError={onError} />);
    await openIt();
    await flush(600);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onError).toHaveBeenCalled();
  });

  it("never closes while issuing", async () => {
    let release!: (v: typeof sealed) => void;
    const pending = new Promise<typeof sealed>((r) => (release = r));
    const { client } = makeClient({ issue: [pending] });
    render(<Harness client={client} run="auto-close" autoCloseDelay={0} />);
    await openIt();
    await flush(10_000);
    expect(screen.getByRole("dialog")).toBeTruthy();
    release(sealed);
    await flush(0);
    await flush(5);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("useFactaWindow().open() resolves with the result when the window closes itself", async () => {
    const { client } = makeClient({ issue: [sealed] });
    let result: unknown;
    function Opener() {
      const { open } = useFactaWindow();
      return <button onClick={() => void open("tok", { run: "auto-close", autoCloseDelay: 300 }).then((r) => (result = r))}>Go</button>;
    }
    render(<FactaProvider client={client} appearance={NO_MOTION}><Opener /></FactaProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await flush(0);
    await flush(0);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(result).toBeUndefined();
    await flush(400);
    expect(screen.queryByRole("dialog")).toBeNull();
    await flush(0);
    expect((result as { numeroControl: string }).numeroControl).toBe(sealed.numeroControl);
  });
});
