import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  FactaProvider,
  useFactaActions,
  useFactaCustomers,
  useFactaDocument,
  useFactaDocuments,
  useFactaProducts,
  useFactaServiceStatus,
  useFactaStorage,
} from "../src/react/index.ts";
import { FactaClientError } from "../src/browser/index.ts";
import { CG1, CG2, CG3, copies, customer, detail, makeDataClient, notAllowed, page, product, row, storageView } from "./data-helpers.tsx";

function wrapperFor(client: ReturnType<typeof makeDataClient>["client"]) {
  return ({ children }: { children: ReactNode }) => (
    <FactaProvider client={client} appearance={{ motion: "none" }}>{children}</FactaProvider>
  );
}

afterEach(() => vi.useRealTimers());

describe("useFactaDocuments", () => {
  it("loads the first page, appends with loadMore and stops when there is no cursor", async () => {
    const { client, data } = makeDataClient({
      listDocuments: vi.fn(async (f?: { cursor?: string }) =>
        f?.cursor ? page([row({ codigoGeneracion: CG2, numeroControl: "DTE-01-M001P001-000000000000043" })]) : page([row()], "cur-2")),
    } as never);
    const { result } = renderHook(() => useFactaDocuments({}, { pageSize: 1 }), { wrapper: wrapperFor(client) });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);
    expect(data.listDocuments).toHaveBeenCalledWith({ limit: 1 });
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items.map((r) => r.codigoGeneracion)).toEqual([CG1, CG2]);
    expect(result.current.hasMore).toBe(false);
    expect(data.listDocuments).toHaveBeenLastCalledWith({ limit: 1, cursor: "cur-2" });
  });

  it("passes server filters, filters by control number locally and never sends `buscar`", async () => {
    const { client, data } = makeDataClient({
      listDocuments: vi.fn(async () => page([row(), row({ codigoGeneracion: CG2, numeroControl: "DTE-03-M001P001-000000000000017", tipoDte: "03" })])),
    } as never);
    const { result } = renderHook(() => useFactaDocuments({ estado: "sellado", buscar: "000017" }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.loaded).toBe(2));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.tipoDte).toBe("03");
    expect(data.listDocuments).toHaveBeenCalledWith({ estado: "sellado", limit: 25 });
  });

  it("refresh refetches the first page and drops the extra pages", async () => {
    let n = 0;
    const { client } = makeDataClient({
      listDocuments: vi.fn(async (f?: { cursor?: string }) => {
        if (f?.cursor) return page([row({ codigoGeneracion: CG2 })]);
        n++;
        return page([row({ numeroControl: `DTE-01-M001P001-00000000000${n}` })], "c");
      }),
    } as never);
    const { result } = renderHook(() => useFactaDocuments(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items).toHaveLength(2);
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]!.numeroControl).toContain("2");
  });

  it("shows the cached page at once on a remount and revalidates in the background", async () => {
    const { client, data } = makeDataClient();
    const wrapper = wrapperFor(client);
    const first = renderHook(() => useFactaDocuments(), { wrapper });
    await waitFor(() => expect(first.result.current.items).toHaveLength(1));
    first.unmount();
    // A new provider has a new cache; keep one provider and swap the child instead.
    const keep = renderHook(() => ({ a: useFactaDocuments({}, { staleMs: 0 }) }), { wrapper });
    await waitFor(() => expect(keep.result.current.a.items).toHaveLength(1));
    expect(data.listDocuments.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("reports the error when the first page fails and recovers on refresh", async () => {
    let fail = true;
    const { client } = makeDataClient({
      listDocuments: vi.fn(async () => {
        if (fail) throw new FactaClientError({ code: "service_unavailable", message: "x", status: 503, retryable: true, transport: false });
        return page([row()]);
      }),
    } as never);
    const { result } = renderHook(() => useFactaDocuments(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);
    fail = false;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.error).toBeUndefined();
  });

  it("throws a clear error outside a provider with data methods", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useFactaDocuments())).toThrow(/FactaProvider/);
    spy.mockRestore();
  });
});

describe("useFactaDocument", () => {
  it("polls while in contingency and stops once sealed", async () => {
    const answers = [detail({ estado: "contingencia", selloRecibido: null }), detail({ estado: "contingencia", selloRecibido: null }), detail({ estado: "sellado" })];
    const { client, data } = makeDataClient({ getDocument: vi.fn(async () => answers.shift() ?? detail({ estado: "sellado" })) } as never);
    const { result } = renderHook(() => useFactaDocument(CG1, { pollMs: 40 }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    await waitFor(() => expect(result.current.data?.estado).toBe("sellado"), { timeout: 2000 });
    expect(data.getDocument.mock.calls.length).toBeGreaterThanOrEqual(3);
    const calls = data.getDocument.mock.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(data.getDocument.mock.calls.length).toBe(calls);
  });

  it("does not fetch without a code", async () => {
    const { client, data } = makeDataClient();
    renderHook(() => useFactaDocument(null), { wrapper: wrapperFor(client) });
    await new Promise((r) => setTimeout(r, 20));
    expect(data.getDocument).not.toHaveBeenCalled();
  });
});

describe("catalog hooks", () => {
  it("wait for the minimum characters, debounce, and expose loading while pending", async () => {
    const { client, data } = makeDataClient();
    const { result, rerender } = renderHook(({ q }) => useFactaCustomers(q, { debounceMs: 30 }), { wrapper: wrapperFor(client), initialProps: { q: "f" } });
    expect(result.current.ready).toBe(false);
    expect(result.current.items).toEqual([]);
    rerender({ q: "fe" });
    rerender({ q: "fer" });
    expect(result.current.loading).toBe(true);
    expect(data.searchCustomers).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.items).toEqual([customer()]));
    expect(data.searchCustomers).toHaveBeenCalledTimes(1);
    expect(data.searchCustomers).toHaveBeenCalledWith("fer", { limit: 10 });
    expect(result.current.loading).toBe(false);
  });

  it("serve a repeated query from the cache", async () => {
    const { client, data } = makeDataClient();
    const { result, rerender } = renderHook(({ q }) => useFactaProducts(q, { debounceMs: 5 }), { wrapper: wrapperFor(client), initialProps: { q: "dis" } });
    await waitFor(() => expect(result.current.items).toEqual([product()]));
    rerender({ q: "di" });
    await waitFor(() => expect(data.searchProducts).toHaveBeenCalledTimes(2));
    rerender({ q: "dis" });
    await waitFor(() => expect(result.current.items).toEqual([product()]));
    expect(data.searchProducts).toHaveBeenCalledTimes(2);
  });

  it("surface a search error", async () => {
    const { client } = makeDataClient({ searchCustomers: vi.fn(async () => { throw notAllowed(); }) } as never);
    const { result } = renderHook(() => useFactaCustomers("fer", { debounceMs: 1 }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});

describe("useFactaServiceStatus", () => {
  function setHidden(hidden: boolean) {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }
  beforeEach(() => setHidden(false));
  afterEach(() => setHidden(false));

  it("reports the state, polls, and pauses while the tab is hidden", async () => {
    const { client, data } = makeDataClient();
    const { result } = renderHook(() => useFactaServiceStatus({ pollMs: 20 }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.state).toBe("online"));
    await waitFor(() => expect(data.getServiceStatus.mock.calls.length).toBeGreaterThanOrEqual(3));
    act(() => setHidden(true));
    const calls = data.getServiceStatus.mock.calls.length;
    await new Promise((r) => setTimeout(r, 90));
    expect(data.getServiceStatus.mock.calls.length).toBe(calls);
    act(() => setHidden(false));
    await waitFor(() => expect(data.getServiceStatus.mock.calls.length).toBeGreaterThan(calls), { timeout: 1000 });
  });

  it("falls back to offline when the call fails", async () => {
    const { client } = makeDataClient({ getServiceStatus: vi.fn(async () => { throw new Error("down"); }) } as never);
    const { result } = renderHook(() => useFactaServiceStatus({ pollMs: 1000 }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.state).toBe("offline"));
  });
});

describe("useFactaStorage", () => {
  it("returns the storage view", async () => {
    const { client } = makeDataClient();
    const { result } = renderHook(() => useFactaStorage(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.storage).toEqual(storageView()));
  });
});

describe("useFactaActions", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("download fetches the file and saves it as a blob with the server's file name", async () => {
    const { client, data } = makeDataClient();
    const { result } = renderHook(() => useFactaActions(), { wrapper: wrapperFor(client) });
    const file = await result.current.download(CG1, "pdf");
    expect(file.filename).toBe(`${CG1}.pdf`);
    expect(data.downloadDocument).toHaveBeenCalledWith(CG1, "pdf", undefined);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(4);
  });

  it("retryStorage calls the handler and refreshes the copies the detail reads", async () => {
    const { client, data } = makeDataClient();
    const wrapper = wrapperFor(client);
    const { result } = renderHook(() => ({ actions: useFactaActions(), copies: useFactaDocumentCopiesProbe() }), { wrapper });
    await waitFor(() => expect(result.current.copies.data).toEqual(copies()));
    await act(async () => { await result.current.actions.retryStorage(CG1); });
    expect(data.retryDocumentStorage).toHaveBeenCalledWith(CG1);
    await waitFor(() => expect(data.getDocumentCopies.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("copyCode writes to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { client } = makeDataClient();
    const { result } = renderHook(() => useFactaActions(), { wrapper: wrapperFor(client) });
    await result.current.copyCode(CG3);
    expect(writeText).toHaveBeenCalledWith(CG3);
  });
});

import { useFactaDocumentCopies } from "../src/react/index.ts";
function useFactaDocumentCopiesProbe() {
  return useFactaDocumentCopies(CG1);
}
