// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The checkout example («Mi propia implementación») must ask for an address when the customer
// ticks «Quiero mi factura por correo»: the bug was a checkbox that sent `sendEmail` with no address,
// so the server answered «no se ha seleccionado ningún correo».
const createSession = vi.fn();
vi.mock("../site/api.ts", () => ({ createSession: (sale: unknown) => createSession(sale) }));
vi.mock("../../browser.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../browser.ts")>();
  return {
    ...real,
    createIssueFlow: () => ({ subscribe: () => () => undefined, start: async () => undefined, destroy: () => undefined, retry: async () => undefined }),
  };
});

const { CheckoutForm } = await import("../site/sections/headless/checkout-form.tsx");

beforeEach(() => createSession.mockReset().mockResolvedValue({ session: "token", total: 17, title: "x", emailTo: null }));
afterEach(cleanup);

describe("checkout example: invoice by e-mail", () => {
  it("shows no address field until the box is ticked, then shows one", () => {
    render(<CheckoutForm disabled={false} />);
    expect(screen.queryByLabelText("Correo del cliente")).toBeNull();
    fireEvent.click(screen.getByLabelText("Quiero mi factura por correo"));
    expect(screen.getByLabelText("Correo del cliente")).toBeTruthy();
  });

  it("does not issue with the box ticked and no valid address", async () => {
    render(<CheckoutForm disabled={false} />);
    fireEvent.click(screen.getByLabelText("Quiero mi factura por correo"));
    // The button is closed while the address is missing, and a bad one is refused before any request.
    expect((screen.getByRole("button", { name: "Pagar y facturar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Correo del cliente"), { target: { value: "no-es-un-correo" } });
    expect((screen.getByRole("button", { name: "Pagar y facturar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("button", { name: "Pagar y facturar" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("correo válido"));
    expect(createSession).not.toHaveBeenCalled();
  });

  it("sends the typed address with the sale, and no address when the box stays off", async () => {
    render(<CheckoutForm disabled={false} />);
    fireEvent.click(screen.getByLabelText("Quiero mi factura por correo"));
    fireEvent.change(screen.getByLabelText("Correo del cliente"), { target: { value: "  cliente@ejemplo.com " } });
    fireEvent.submit(screen.getByRole("button", { name: "Pagar y facturar" }).closest("form")!);
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession.mock.calls[0]![0]).toMatchObject({ tipoDte: "01", sendEmail: true, emailTo: "cliente@ejemplo.com" });

    cleanup();
    createSession.mockClear();
    render(<CheckoutForm disabled={false} />);
    fireEvent.submit(screen.getByRole("button", { name: "Pagar y facturar" }).closest("form")!);
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession.mock.calls[0]![0]).not.toHaveProperty("sendEmail");
    expect(createSession.mock.calls[0]![0]).not.toHaveProperty("emailTo");
  });
});
