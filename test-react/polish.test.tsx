import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { colorToSrgb, resolveAccentInk } from "../src/browser/index.ts";
import { FactaInvoiceDialog, FactaIssueButton, FactaProvider, FactaReceipt } from "../src/react/index.ts";
import { shouldDismiss } from "../src/react/sheet-drag.ts";
import { FAST, makeClient, NO_MOTION, sealed, sessionInfo } from "./helpers.tsx";

afterEach(() => vi.restoreAllMocks());

describe("FactaReceipt card", () => {
  it("prints badge, «Factura · Pedido», date, pill, total, identifiers and tiles", () => {
    render(<FactaReceipt result={sealed} reference="#1042" appearance={NO_MOTION} />);
    const card = screen.getByRole("article", { name: "Factura · Pedido #1042" });
    expect(within(card).getByText("Sellada")).toBeTruthy();
    expect(within(card).getByText("05/10/2026 14:32")).toBeTruthy();
    expect(within(card).getByText("$1,234.56")).toBeTruthy();
    expect(within(card).getByText("Guardadas")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Descargar PDF" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Descargar JSON" })).toBeTruthy();
    // The control number has no copy button; the generation code has one.
    expect(within(card).queryByRole("button", { name: /Copiar Número de control/ })).toBeNull();
    expect(within(card).getByRole("button", { name: "Copiar Código de generación" })).toBeTruthy();
    expect(within(card).queryByText(sealed.selloRecibido!)).toBeNull();
  });

  it("uses a warning pill for a contingency document", () => {
    render(<FactaReceipt result={{ ...sealed, estado: "contingencia", representacionGrafica: null }} appearance={NO_MOTION} />);
    expect(screen.getByText("En contingencia")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Descargar PDF" })).toBeNull();
  });
});

describe("copy feedback", () => {
  it("shows «Copiado» for 1.6 s and announces it politely", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<FactaReceipt result={sealed} appearance={NO_MOTION} />);
    const button = screen.getByRole("button", { name: "Copiar Código de generación" });
    await act(async () => { fireEvent.click(button); });
    expect(writeText).toHaveBeenCalledWith(sealed.codigoGeneracion);
    expect(button.getAttribute("data-copied")).toBe("");
    const live = button.querySelector('[role="status"]')!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("Copiado");
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(button.getAttribute("data-copied")).toBe("");
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(button.getAttribute("data-copied")).toBeNull();
    expect(live.textContent).toBe("");
    vi.useRealTimers();
  });
});

describe("issue button popover", () => {
  it("shows badge, total, code with copy, one PDF tile and the short attribution", async () => {
    const { client } = makeClient({ issue: [sealed] });
    const view = render(
      <FactaProvider client={client} appearance={NO_MOTION}>
        <FactaIssueButton session="tok" run="auto" flowOptions={FAST} />
      </FactaProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Emitida/ }));
    const pop = await screen.findByRole("dialog");
    expect(within(pop).getByText("Factura emitida")).toBeTruthy();
    expect(within(pop).getByText("$1,234.56")).toBeTruthy();
    expect(within(pop).getByRole("button", { name: "Copiar Código de generación" })).toBeTruthy();
    expect(within(pop).getByRole("button", { name: "Descargar PDF" })).toBeTruthy();
    expect(within(pop).queryByRole("button", { name: "Descargar JSON" })).toBeNull();
    expect(within(pop).getByText("factadte.com")).toBeTruthy();
    view.unmount();
  });

  it("drops the attribution when branding.attribution is false", async () => {
    const { client } = makeClient({ issue: [sealed] });
    render(
      <FactaProvider client={client} appearance={NO_MOTION} branding={{ attribution: false }}>
        <FactaIssueButton session="tok" run="auto" flowOptions={FAST} />
      </FactaProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Emitida/ }));
    const pop = await screen.findByRole("dialog");
    expect(within(pop).queryByText("factadte.com")).toBeNull();
  });
});

describe("sheet drag-to-dismiss", () => {
  it("decides on distance (80 px) or velocity (0.5 px/ms)", () => {
    expect(shouldDismiss(80, 1000)).toBe(true);
    expect(shouldDismiss(79, 1000)).toBe(false);
    expect(shouldDismiss(40, 50)).toBe(true);
    expect(shouldDismiss(40, 200)).toBe(false);
    expect(shouldDismiss(-120, 10)).toBe(false);
    expect(shouldDismiss(5, 1)).toBe(false);
  });

  async function openSheet(extra: Partial<React.ComponentProps<typeof FactaInvoiceDialog>> = {}, issue: Array<typeof sealed | Promise<typeof sealed>> = [sealed]) {
    const { client } = makeClient({ describe: sessionInfo(), issue });
    const onClose = vi.fn();
    render(
      <FactaProvider client={client} appearance={NO_MOTION}>
        <FactaInvoiceDialog open session="tok" presentation="sheet" onClose={onClose} flowOptions={FAST} {...extra} />
      </FactaProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    const grab = dialog.querySelector<HTMLElement>(".facta-grab")!;
    return { dialog, grab, onClose };
  }

  it("closes when the handle is dragged down past the threshold", async () => {
    const { grab, onClose } = await openSheet();
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(grab, { pointerId: 1, clientY: 150 });
    fireEvent.pointerUp(grab, { pointerId: 1, clientY: 200 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("springs back when the drag is short and slow", async () => {
    const { grab, onClose } = await openSheet();
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(grab, { pointerId: 1, clientY: 120 });
    await new Promise((r) => setTimeout(r, 120));
    fireEvent.pointerUp(grab, { pointerId: 1, clientY: 120 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not drag while issuing", async () => {
    let release!: (v: typeof sealed) => void;
    const pending = new Promise<typeof sealed>((r) => (release = r));
    const { dialog, grab, onClose } = await openSheet({ run: "auto" }, [pending]);
    expect(grab.hasAttribute("data-draggable")).toBe(false);
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 0 });
    fireEvent.pointerUp(grab, { pointerId: 1, clientY: 300 });
    expect(onClose).not.toHaveBeenCalled();
    release(sealed);
    void dialog;
  });

  it("with motion the card follows the finger; with reduced motion it only closes", async () => {
    const { dialog, grab } = await openSheet();
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 0 });
    fireEvent.pointerMove(grab, { pointerId: 1, clientY: 30 });
    // NO_MOTION is motion "none": no following.
    expect(dialog.querySelector<HTMLElement>(".facta-card")!.style.transform).toBe("");
  });

  it("follows the finger at full motion", async () => {
    const { client } = makeClient({ describe: sessionInfo(), issue: [sealed] });
    render(
      <FactaProvider client={client} appearance={{ motion: "full" }}>
        <FactaInvoiceDialog open session="tok" presentation="sheet" onClose={() => {}} flowOptions={FAST} />
      </FactaProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    const grab = dialog.querySelector<HTMLElement>(".facta-grab")!;
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 0 });
    fireEvent.pointerMove(grab, { pointerId: 1, clientY: 30 });
    expect(dialog.querySelector<HTMLElement>(".facta-card")!.style.transform).toBe("translateY(30px)");
  });

  it("cancels the auto-close countdown", async () => {
    const { client } = makeClient({ describe: sessionInfo(), issue: [sealed] });
    const onClose = vi.fn();
    render(
      <FactaProvider client={client} appearance={{ motion: "reduced" }}>
        <FactaInvoiceDialog open session="tok" presentation="sheet" run="auto-close" autoCloseDelay={400} onClose={onClose} flowOptions={FAST} />
      </FactaProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Se cerrará en/);
    fireEvent.pointerDown(dialog.querySelector(".facta-grab")!, { pointerId: 1, clientY: 0 });
    await new Promise((r) => setTimeout(r, 600));
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).queryByText(/Se cerrará en/)).toBeNull();
  });
});

describe("accent ink from computed colours", () => {
  it("converts oklch, oklab, hsl and color(srgb) to sRGB", () => {
    const [r, g, b] = colorToSrgb("oklch(0.55 0.13 225)")!;
    expect(r).toBeLessThan(40);
    expect(g).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(140);
    expect(colorToSrgb("oklch(1 0 0)")).toEqual([255, 255, 255]);
    expect(colorToSrgb("oklab(0 0 0)")).toEqual([0, 0, 0]);
    expect(colorToSrgb("hsl(0 100% 50%)")).toEqual([255, 0, 0]);
    expect(colorToSrgb("color(srgb 1 0.5 0)")).toEqual([255, 128, 0]);
    expect(colorToSrgb("lab(50 10 10)")).toBeNull();
  });

  function probeWith(computed: string, valid = true) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      if (el.parentElement === root) return { color: computed } as CSSStyleDeclaration;
      return real(el);
    });
    vi.spyOn(window, "CSS", "get").mockReturnValue({ supports: () => valid } as unknown as typeof CSS);
    return root;
  }

  it("picks white ink for a dark oklch() accent and dark ink for a light one", () => {
    expect(resolveAccentInk("oklch(0.45 0.13 225)", probeWith("oklch(0.45 0.13 225)"))?.ink).toBe("#ffffff");
    expect(resolveAccentInk("oklch(0.9 0.17 100)", probeWith("oklch(0.9 0.17 100)"))?.ink).toBe("#0b1419");
  });

  it("resolves var() and named colours through their computed value", () => {
    expect(resolveAccentInk("var(--brand)", probeWith("rgb(250, 220, 20)"))?.ink).toBe("#0b1419");
    expect(resolveAccentInk("navy", probeWith("rgb(0, 0, 128)"))?.ink).toBe("#ffffff");
  });

  it("leaves no probe behind and returns null for an invalid colour", () => {
    const root = probeWith("rgb(0, 0, 0)");
    resolveAccentInk("oklch(0.45 0.13 225)", root);
    expect(root.children.length).toBe(0);
    expect(resolveAccentInk("not a colour", probeWith("rgb(0, 0, 0)", false))).toBeNull();
    vi.unstubAllGlobals();
  });

  it("FactaRoot applies the runtime ink for an oklch accent", async () => {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "CSS", "get").mockReturnValue({ supports: () => true } as unknown as typeof CSS);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) =>
      el instanceof HTMLElement && el.getAttribute("aria-hidden") === "true" && el.style.position === "absolute"
        ? ({ color: "oklch(0.92 0.17 100)" } as CSSStyleDeclaration)
        : real(el)
    );
    render(<FactaReceipt result={sealed} appearance={{ ...NO_MOTION, variables: { accent: "oklch(0.92 0.17 100)" } }} />);
    const root = document.querySelector<HTMLElement>(".facta-root")!;
    expect(root.style.getPropertyValue("--facta-accent-ink")).toBe("#0b1419");
  });
});
