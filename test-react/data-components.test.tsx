import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FactaCustomerPicker,
  FactaDocumentDetail,
  FactaDocumentList,
  FactaDownloadButton,
  FactaInvalidateDialog,
  FactaProductPicker,
  FactaProvider,
  FactaServiceStatus,
  FactaStorageMeter,
  useFactaActions,
  FactaWindowError,
} from "../src/react/index.ts";
import { FactaClientError } from "../src/browser/index.ts";
import {
  CG1,
  CG2,
  copies,
  customer,
  detail,
  invInfo,
  makeDataClient,
  notAllowed,
  page,
  phone,
  product,
  row,
  stubMatchMedia,
  storageView,
} from "./data-helpers.tsx";

const NO_MOTION = { motion: "none" as const };

function mount(ui: React.ReactNode, client = makeDataClient()) {
  render(<FactaProvider client={client.client} appearance={NO_MOTION}>{ui}</FactaProvider>);
  return client;
}

beforeEach(() => {
  stubMatchMedia(() => false);
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const rows = [
  row(),
  row({ codigoGeneracion: CG2, numeroControl: "DTE-03-M001P001-000000000000017", tipoDte: "03", estado: "contingencia", totales: { totalPagar: 1234.56 } }),
  row({ codigoGeneracion: "3B2A1C0D-4E5F-4A6B-8C7D-9E0F1A2B3C4D", numeroControl: "DTE-01-M001P001-000000000000040", estado: "invalidado" }),
];

describe("FactaDocumentList", () => {
  it("shows a skeleton, then the table with badges, amounts and a hidden receiver", async () => {
    const c = makeDataClient({ listDocuments: vi.fn(async () => page(rows)) } as never);
    mount(<FactaDocumentList />, c);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    const table = await screen.findByRole("table", { name: "Documentos" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getAllByText("$113.00")).toHaveLength(2);
    expect(within(table).getByText("$1,234.56")).toBeTruthy();
    expect(within(table).getByText("Sellado")).toBeTruthy();
    expect(within(table).getByText("En contingencia")).toBeTruthy();
    expect(within(table).getByText("Invalidado")).toBeTruthy();
    expect(within(table).getAllByText("Oculto")).toHaveLength(3);
    expect(screen.getByText("Mostrando 3")).toBeTruthy();
    expect(screen.getByText("Powered by factadte.com")).toBeTruthy();
  });

  it("shows the receiver and the masked document when the server sent them", async () => {
    const c = makeDataClient({
      listDocuments: vi.fn(async () => page([row({ receptor: { nombre: "María José Hernández", numDocumento: "0000 ••••• 9" } }), row({ codigoGeneracion: CG2, receptor: null })])),
    } as never);
    mount(<FactaDocumentList />, c);
    expect(await screen.findByText("María José Hernández")).toBeTruthy();
    expect(screen.getByText("0000 ••••• 9")).toBeTruthy();
    expect(screen.getByText("Consumidor final")).toBeTruthy();
    expect(screen.queryByText("Oculto")).toBeNull();
  });

  it("paginates with «Cargar más» and keeps the already loaded rows", async () => {
    const c = makeDataClient({
      listDocuments: vi.fn(async (f?: { cursor?: string }) => (f?.cursor ? page([rows[1]!]) : page([rows[0]!], "next"))),
    } as never);
    mount(<FactaDocumentList pageSize={1} />, c);
    const more = await screen.findByRole("button", { name: "Cargar más" });
    await userEvent.setup().click(more);
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("row menu: keyboard opens it, ↓ moves, Enter downloads, Esc closes and returns focus", async () => {
    const c = mount(<FactaDocumentList />);
    const user = userEvent.setup();
    const kebab = await screen.findByRole("button", { name: /Acciones: DTE-01/ });
    kebab.focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    expect(document.activeElement?.textContent).toContain("Descargar PDF");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toContain("Descargar JSON");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(c.data.downloadDocument).toHaveBeenCalledWith(CG1, "json", undefined));
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(kebab);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(kebab);
    void menu;
  });

  it("row menu: copy code and «Ver detalle» (opens the drawer with the server's totals)", async () => {
    const c = mount(<FactaDocumentList />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Acciones: DTE-01/ }));
    await user.click(screen.getByRole("menuitem", { name: "Copiar código de generación" }));
    expect(await screen.findByText("Código copiado")).toBeTruthy();
    expect(await navigator.clipboard.readText()).toBe(CG1);
    await user.click(screen.getByRole("button", { name: /Acciones: DTE-01/ }));
    await user.click(screen.getByRole("menuitem", { name: "Ver detalle" }));
    const drawer = await screen.findByRole("dialog");
    await waitFor(() => expect(c.data.getDocument).toHaveBeenCalledWith(CG1));
    expect(await within(drawer).findByText("Identificadores")).toBeTruthy();
    expect(within(drawer).getAllByText("$113.00").length).toBeGreaterThan(0);
  });

  it("offers «Anular documento» only with onInvalidate and only on sealed rows, and opens the dialog with the host's token", async () => {
    const c = makeDataClient({ listDocuments: vi.fn(async () => page(rows)) } as never);
    const onInvalidate = vi.fn(async () => "inv-token");
    mount(<FactaDocumentList onInvalidate={onInvalidate} />, c);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Acciones: DTE-03/ }));
    expect(screen.queryByRole("menuitem", { name: "Anular documento" })).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Acciones: DTE-01-M001P001-000000000000042/ }));
    await user.click(screen.getByRole("menuitem", { name: "Anular documento" }));
    expect(onInvalidate).toHaveBeenCalledWith(expect.objectContaining({ codigoGeneracion: CG1 }));
    await waitFor(() => expect(c.data.describeInvalidation).toHaveBeenCalledWith("inv-token"));
    expect(await screen.findByRole("button", { name: "Anular documento" })).toBeTruthy();
  });

  it("hides «Anular» without onInvalidate", async () => {
    mount(<FactaDocumentList />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Acciones/ }));
    expect(screen.queryByRole("menuitem", { name: "Anular documento" })).toBeNull();
  });

  it("filters: a type and a state go to the handler; the search narrows the loaded rows locally", async () => {
    const c = makeDataClient({ listDocuments: vi.fn(async () => page(rows)) } as never);
    mount(<FactaDocumentList />, c);
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tipo" }), "03");
    await waitFor(() => expect(c.data.listDocuments).toHaveBeenLastCalledWith({ tipoDte: "03", limit: 25 }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Estado" }), "sellado");
    await waitFor(() => expect(c.data.listDocuments).toHaveBeenLastCalledWith({ tipoDte: "03", estado: "sellado", limit: 25 }));
    await user.type(screen.getByRole("searchbox"), "000017");
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
    expect(c.data.listDocuments.mock.calls.every(([f]) => !("buscar" in (f as object)))).toBe(true);
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(await screen.findByText("Ningún documento coincide")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]!);
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
    expect(screen.queryByText("Ningún documento coincide")).toBeNull();
  });

  it("period presets send dates", async () => {
    const c = makeDataClient();
    mount(<FactaDocumentList />, c);
    await screen.findByRole("table");
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Período" }), "today");
    await waitFor(() => {
      const last = c.data.listDocuments.mock.calls.at(-1)![0] as { desde?: string; hasta?: string };
      expect(last.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(last.hasta).toBe(last.desde);
    });
  });

  it("empty and error states; the error shows the literal code and retries", async () => {
    const empty = makeDataClient({ listDocuments: vi.fn(async () => page([])) } as never);
    const { unmount } = render(<FactaProvider client={empty.client} appearance={NO_MOTION}><FactaDocumentList /></FactaProvider>);
    expect(await screen.findByText("Todavía no hay documentos en este período")).toBeTruthy();
    unmount();
    let fail = true;
    const c = makeDataClient({
      listDocuments: vi.fn(async () => {
        if (fail) throw new FactaClientError({ code: "service_unavailable", message: "x", status: 503, retryable: true, transport: false });
        return page([row()]);
      }),
    } as never);
    mount(<FactaDocumentList />, c);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("No pudimos cargar los documentos")).toBeTruthy();
    expect(within(alert).getByText("service_unavailable")).toBeTruthy();
    fail = false;
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("table");
  });

  it("renders cards on a phone, with the filters behind a button", async () => {
    phone();
    mount(<FactaDocumentList />);
    expect(await screen.findByRole("list", { name: "Documentos" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    const user = userEvent.setup();
    expect(screen.queryByRole("combobox", { name: "Tipo" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByRole("combobox", { name: "Tipo" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Factura DTE-01/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("applies classNames, styles and the data-facta-slot attributes", async () => {
    mount(<FactaDocumentList classNames={{ list: "mi-lista", row: "mi-fila" }} styles={{ list: { padding: 3 } }} />);
    await screen.findByRole("table");
    const list = document.querySelector('[data-facta-slot="list"]') as HTMLElement;
    expect(list.className).toContain("mi-lista");
    expect(list.style.padding).toBe("3px");
    expect(document.querySelector('[data-facta-slot="row"]')!.className).toContain("mi-fila");
  });

  it("hides the attribution with branding.attribution=false", async () => {
    mount(<FactaDocumentList branding={{ attribution: false }} />);
    await screen.findByRole("table");
    expect(screen.queryByText("Powered by factadte.com")).toBeNull();
  });
});

describe("FactaDocumentDetail", () => {
  it("shows identifiers, the server's totals, the copies block and the timeline", async () => {
    mount(<FactaDocumentDetail codigoGeneracion={CG1} open onOpenChange={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Identificadores");
    expect(within(dialog).getByText(CG1)).toBeTruthy();
    expect(within(dialog).getByText("Gravado")).toBeTruthy();
    expect(within(dialog).getByText("IVA")).toBeTruthy();
    expect(within(dialog).getByText("$13.00")).toBeTruthy();
    expect(within(dialog).getByText("Oculto en esta vista")).toBeTruthy();
    expect(await within(dialog).findByText("JSON")).toBeTruthy();
    expect(within(dialog).getAllByText("Guardadas").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Sellada por Hacienda")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Copiar Código de generación" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Copiar Número de control/ })).toBeNull();
  });

  it("never recomputes totals: it prints what the server sent even if it does not add up", async () => {
    const c = makeDataClient({ getDocument: vi.fn(async () => detail({ totales: { totalGravada: 1, totalIva: 1, totalPagar: 999 } })) } as never);
    mount(<FactaDocumentDetail codigoGeneracion={CG1} open />, c);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Totales");
    expect(within(dialog).getAllByText("$999.00").length).toBeGreaterThan(0);
  });

  it("failed copies offer «Reintentar», which calls the handler and re-reads", async () => {
    let state: "failed" | "stored" = "failed";
    const c = makeDataClient({
      getDocumentCopies: vi.fn(async () => copies(state)),
      retryDocumentStorage: vi.fn(async () => { state = "stored"; return { json: "stored", pdf: "stored" }; }),
    } as never);
    mount(<FactaDocumentDetail codigoGeneracion={CG1} open />, c);
    const dialog = await screen.findByRole("dialog");
    const retry = await within(dialog).findByRole("button", { name: "Reintentar" });
    await userEvent.setup().click(retry);
    await waitFor(() => expect(c.data.retryDocumentStorage).toHaveBeenCalledWith(CG1));
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Reintentar" })).toBeNull());
  });

  it("hides the copies block when the handler refuses it", async () => {
    const c = makeDataClient({ getDocumentCopies: vi.fn(async () => { throw notAllowed(); }) } as never);
    mount(<FactaDocumentDetail codigoGeneracion={CG1} open />, c);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Identificadores");
    await waitFor(() => expect(c.data.getDocumentCopies).toHaveBeenCalled());
    expect(within(dialog).queryByText("Copias")).toBeNull();
  });

  it("invalidated documents show a struck total, the invalidated step and no «Anular»", async () => {
    const c = makeDataClient({ getDocument: vi.fn(async () => detail({ estado: "invalidado" })) } as never);
    mount(<FactaDocumentDetail codigoGeneracion={CG1} open onInvalidate={() => "t"} />, c);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Invalidada")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Anular" })).toBeNull();
    expect(dialog.querySelector("[data-void]")).not.toBeNull();
  });

  it("sealed documents offer «Anular» only when the host gives a token", async () => {
    const onInvalidate = vi.fn(async () => "tok");
    const c = mount(<FactaDocumentDetail codigoGeneracion={CG1} open onInvalidate={onInvalidate} />);
    const dialog = await screen.findByRole("dialog");
    await userEvent.setup().click(await within(dialog).findByRole("button", { name: "Anular" }));
    expect(onInvalidate).toHaveBeenCalledWith(expect.objectContaining({ codigoGeneracion: CG1 }));
    await waitFor(() => expect(c.data.describeInvalidation).toHaveBeenCalledWith("tok"));
  });

  it("contingency shows the waiting step", async () => {
    const c = makeDataClient({ getDocument: vi.fn(async () => detail({ estado: "contingencia", selloRecibido: null })) } as never);
    mount(<FactaDocumentDetail codigoGeneracion={CG1} open />, c);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Esperando el sello de Hacienda")).toBeTruthy();
  });

  it("shows the receiver when exposed, and Esc closes", async () => {
    const onOpenChange = vi.fn();
    const c = makeDataClient({ getDocument: vi.fn(async () => detail({ receptor: { nombre: "María José Hernández", numDocumento: "0000 ••••• 9" } })) } as never);
    mount(<FactaDocumentDetail codigoGeneracion={CG1} open onOpenChange={onOpenChange} />, c);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("María José Hernández")).toBeTruthy();
    await userEvent.setup().keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows an error with retry when the document cannot load", async () => {
    let fail = true;
    const c = makeDataClient({ getDocument: vi.fn(async () => { if (fail) throw new Error("x"); return detail(); }) } as never);
    mount(<FactaDocumentDetail codigoGeneracion={CG1} open />, c);
    const dialog = await screen.findByRole("dialog");
    const alert = await within(dialog).findByRole("alert");
    fail = false;
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Reintentar" }));
    expect(await within(dialog).findByText("Identificadores")).toBeTruthy();
  });

  it("renders inline without a dialog", async () => {
    mount(<FactaDocumentDetail codigoGeneracion={CG1} presentation="inline" />);
    expect(await screen.findByText("Identificadores")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("on a phone it is a bottom sheet", async () => {
    phone();
    mount(<FactaDocumentDetail codigoGeneracion={CG1} open />);
    await screen.findByRole("dialog");
    expect(document.querySelector(".facta-layer--sheet")).not.toBeNull();
    expect(document.querySelector(".facta-grab")).not.toBeNull();
  });
});

describe("FactaDownloadButton", () => {
  it("downloads the PDF, shows loading then done, and returns to idle", async () => {
    let release!: () => void;
    const c = makeDataClient();
    c.data.downloadDocument.mockImplementation(() => new Promise((r) => { release = () => r({ codigoGeneracion: CG1, kind: "pdf", filename: "a.pdf", contentType: "application/pdf", bytes: 4, base64: "JVBERg==" }); }));
    const onDownloaded = vi.fn();
    mount(<FactaDownloadButton codigoGeneracion={CG1} onDownloaded={onDownloaded} />, c);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Descargar PDF" }));
    const loading = await screen.findByRole("button", { name: /Preparando PDF/ });
    expect((loading as HTMLButtonElement).disabled).toBe(true);
    release();
    expect((await screen.findAllByText("PDF descargado")).length).toBeGreaterThan(0);
    expect(onDownloaded).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("the chevron opens a menu with PDF, JSON and ticket; choosing JSON downloads JSON", async () => {
    const c = mount(<FactaDownloadButton codigoGeneracion={CG1} paperWidthMm={58} />);
    const user = userEvent.setup();
    const more = screen.getByRole("button", { name: "Más formatos" });
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    await user.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByRole("menuitem", { name: /JSON/ }));
    await waitFor(() => expect(c.data.downloadDocument).toHaveBeenCalledWith(CG1, "json", undefined));
    await user.click(screen.getByRole("button", { name: "Más formatos" }));
    await user.click(screen.getByRole("menuitem", { name: /ticket/i }));
    await waitFor(() => expect(c.data.downloadDocument).toHaveBeenLastCalledWith(CG1, "ticket", { paperWidthMm: 58 }));
  });

  it("variants: icon-only has no menu; one kind has no chevron; sm uses the short label", async () => {
    mount(<><FactaDownloadButton codigoGeneracion={CG1} variant="icon" /><FactaDownloadButton codigoGeneracion={CG1} kinds={["json"]} size="sm" variant="outline" /></>);
    expect(screen.getAllByRole("button", { name: /Descargar/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Más formatos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Descargar JSON" }).textContent).toBe("JSON");
  });

  it("reports a failure without throwing", async () => {
    const c = makeDataClient({ downloadDocument: vi.fn(async () => { throw new Error("boom"); }) } as never);
    const onError = vi.fn();
    mount(<FactaDownloadButton codigoGeneracion={CG1} onError={onError} />, c);
    await userEvent.setup().click(screen.getByRole("button", { name: "Descargar PDF" }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect((await screen.findAllByText("No se pudo descargar")).length).toBeGreaterThan(0);
  });
});

describe("pickers", () => {
  it("customer combobox: ARIA wiring, hint under two characters, highlight, ↓ Enter returns the catalog id", async () => {
    const onChange = vi.fn();
    const c = makeDataClient({ searchCustomers: vi.fn(async () => [customer(), customer({ id: "c2", name: "Ferretería El Tornillo", docNumber: "0614 ••••• 2" })]) } as never);
    mount(<FactaCustomerPicker onChange={onChange} debounceMs={5} />, c);
    const user = userEvent.setup();
    const input = screen.getByRole("combobox", { name: "Cliente" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    await user.type(input, "f");
    expect(await screen.findByText("Escriba al menos 2 caracteres")).toBeTruthy();
    expect(c.data.searchCustomers).not.toHaveBeenCalled();
    await user.type(input, "er");
    const list = await screen.findByRole("listbox", { name: "Cliente" });
    await within(list).findAllByRole("option");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    expect(list.querySelector("mark")!.textContent?.toLowerCase()).toBe("fer");
    const options = within(list).getAllByRole("option");
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    await user.keyboard("{ArrowDown}");
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "c2" }));
    expect(await screen.findByRole("button", { name: "Quitar selección" })).toBeTruthy();
    expect(screen.getByText("Ferretería El Tornillo")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Quitar selección" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("combobox", { name: "Cliente" })).toBeTruthy();
  });

  it("Escape closes the list, ArrowUp wraps, Tab closes", async () => {
    const c = makeDataClient({ searchProducts: vi.fn(async () => [product(), product({ id: "p2", description: "Candado", code: "CAN-1" })]) } as never);
    mount(<FactaProductPicker debounceMs={5} />, c);
    const user = userEvent.setup();
    const input = screen.getByRole("combobox", { name: "Producto" });
    await user.type(input, "ca");
    const list = await screen.findByRole("listbox");
    await within(list).findAllByRole("option");
    await user.keyboard("{ArrowUp}");
    expect(within(list).getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Escape}");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await user.tab();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("product picker shows code, price and the VAT tag, returns the catalog id and clears for the next line", async () => {
    const onSelect = vi.fn();
    mount(<FactaProductPicker onSelect={onSelect} debounceMs={5} />);
    const user = userEvent.setup();
    const input = screen.getByRole("combobox", { name: "Producto" }) as HTMLInputElement;
    await user.type(input, "dis");
    const option = await screen.findByRole("option");
    expect(option.textContent).toContain("DIS-114");
    expect(within(option).getByText("$2.85")).toBeTruthy();
    expect(within(option).getByText("IVA incluido")).toBeTruthy();
    await user.click(option);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
    expect(input.value).toBe("");
  });

  it("empty and error states", async () => {
    const c = makeDataClient({ searchProducts: vi.fn(async () => []) } as never);
    const { unmount } = render(<FactaProvider client={c.client} appearance={NO_MOTION}><FactaProductPicker debounceMs={5} /></FactaProvider>);
    await userEvent.setup().type(screen.getByRole("combobox"), "ferrex");
    expect(await screen.findByText("Sin resultados para «ferrex»")).toBeTruthy();
    unmount();
    const bad = makeDataClient({ searchProducts: vi.fn(async () => { throw new Error("x"); }) } as never);
    mount(<FactaProductPicker debounceMs={5} />, bad);
    await userEvent.setup().type(screen.getByRole("combobox"), "ab");
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("announces the number of results politely", async () => {
    mount(<FactaCustomerPicker debounceMs={5} />);
    await userEvent.setup().type(screen.getByRole("combobox"), "fe");
    await waitFor(() => expect(screen.getByText("1 resultados")).toBeTruthy());
  });
});

describe("FactaServiceStatus", () => {
  const states = [
    ["online", "Hacienda en línea"],
    ["contingency", "Hacienda en contingencia"],
    ["degraded", "Servicio con avisos"],
    ["offline", "Sin conexión con Facta"],
  ] as const;
  for (const [state, text] of states) {
    it(`pill says «${text}» for ${state}`, async () => {
      const c = makeDataClient({ getServiceStatus: vi.fn(async () => ({ state, checkedAt: "x" })) } as never);
      mount(<FactaServiceStatus />, c);
      const pill = await screen.findByRole("status");
      await waitFor(() => expect(pill.textContent).toContain(text));
      expect(pill.getAttribute("data-state")).toBe(state);
    });
  }

  it("shows «Comprobando…» before the first answer and a tooltip on focus", async () => {
    const c = makeDataClient({ getServiceStatus: vi.fn(async () => ({ state: "contingency" as const, checkedAt: "x" })) } as never);
    mount(<FactaServiceStatus />, c);
    expect(screen.getByRole("status").textContent).toContain("Comprobando…");
    await waitFor(() => expect(screen.getByRole("status").getAttribute("data-state")).toBe("contingency"));
    screen.getByRole("status").focus();
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toContain("se enviarán solos");
  });

  it("dot variant exposes the state in aria-label", async () => {
    mount(<FactaServiceStatus variant="dot" />);
    const dot = await screen.findByRole("img", { name: /Hacienda en línea/ });
    await waitFor(() => expect(dot.getAttribute("data-state")).toBe("online"));
  });

  it("reports changes", async () => {
    const onChange = vi.fn();
    mount(<FactaServiceStatus onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("online"));
  });
});

describe("FactaStorageMeter", () => {
  async function level(view: ReturnType<typeof storageView>, props: { warnAt?: number } = {}) {
    const c = makeDataClient({ getStorageStatus: vi.fn(async () => view) } as never);
    mount(<FactaStorageMeter {...props} />, c);
    return await waitFor(() => {
      const el = document.querySelector("[data-level]");
      expect(el).not.toBeNull();
      return el!;
    });
  }

  it("normal under the threshold, with used/total and free space", async () => {
    const el = await level(storageView());
    expect(el.getAttribute("data-level")).toBe("normal");
    expect(screen.getByText("1.2 GB de 5.0 GB")).toBeTruthy();
    expect(screen.getByText("24 % usado")).toBeTruthy();
    expect(screen.getByText("3.8 GB libres")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("24");
    expect(screen.queryByText("Le queda poco espacio")).toBeNull();
  });

  it("near from 85 % with a warning, and warnAt is configurable", async () => {
    const el = await level(storageView({ usedBytes: 4_400_000_000 }));
    expect(el.getAttribute("data-level")).toBe("near");
    expect(screen.getByText("Le queda poco espacio")).toBeTruthy();
    expect(screen.getByText(/Quedan 600\.0 MB/)).toBeTruthy();
  });

  it("warnAt moves the threshold", async () => {
    const el = await level(storageView({ usedBytes: 2_600_000_000 }), { warnAt: 50 });
    expect(el.getAttribute("data-level")).toBe("near");
  });

  it("full at 100 %", async () => {
    const el = await level(storageView({ usedBytes: 5_000_000_000 }));
    expect(el.getAttribute("data-level")).toBe("full");
    expect(screen.getByText("El almacenamiento de Facta está lleno")).toBeTruthy();
    expect(screen.getByText("Sin espacio libre")).toBeTruthy();
  });

  it("unconfigured shows no figures", async () => {
    const el = await level(storageView({ configured: false, quotaBytes: null, usedBytes: null }));
    expect(el.getAttribute("data-level")).toBe("none");
    expect(screen.getByText(/se guardan solo en sus propios destinos/)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows an error with retry", async () => {
    let fail = true;
    const c = makeDataClient({ getStorageStatus: vi.fn(async () => { if (fail) throw new Error("x"); return storageView(); }) } as never);
    mount(<FactaStorageMeter />, c);
    const alert = await screen.findByRole("alert");
    fail = false;
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(document.querySelector("[data-level]")).not.toBeNull());
  });
});

describe("FactaInvalidateDialog", () => {
  it("confirm → progress → success with the event seal; the data is read-only", async () => {
    let release!: () => void;
    const c = makeDataClient();
    c.data.invalidate.mockImplementation(() => new Promise((r) => {
      release = () => r({ estado: "invalidado", codigoGeneracion: CG1, numeroControl: "n", yaEstabaInvalidado: false, evento: { codigoGeneracion: CG2, selloRecibido: "2026D81C07A4E5B93F62A1D08C74B5E3F9A026C1", fhProcesamiento: null, tipoAnulacion: 1 } });
    }));
    const onInvalidated = vi.fn();
    mount(<FactaInvalidateDialog session="tok" open onOpenChange={() => {}} onInvalidated={onInvalidated} />, c);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Preparado por su sistema · solo lectura")).toBeTruthy();
    expect(dialog.querySelectorAll("input, textarea, select")).toHaveLength(0);
    expect(within(dialog).getByText(/Error en la información, se reemplaza/)).toBeTruthy();
    expect(within(dialog).getByText(CG2)).toBeTruthy();
    expect(within(dialog).getByText("Precio incorrecto en la línea 2")).toBeTruthy();
    expect(within(dialog).getByText("Laura Beatriz Ortiz")).toBeTruthy();
    expect(within(dialog).getByText("La anulación no se puede deshacer")).toBeTruthy();
    expect(within(dialog).getAllByRole("button", { name: "Anular documento" })).toHaveLength(1);
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("button", { name: "Anular documento" }));
    expect(await within(dialog).findByText("Anulando…", { selector: "h2" })).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: /Anulando…/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).queryByRole("button", { name: "Cerrar ventana" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    release();
    expect(await within(dialog).findByText("Documento anulado")).toBeTruthy();
    expect(within(dialog).getByText("2026D81C07A4E5B93F62A1D08C74B5E3F9A026C1")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Copiar Sello del evento" })).toBeTruthy();
    expect(onInvalidated).toHaveBeenCalledWith(expect.objectContaining({ estado: "invalidado" }));
    expect(c.data.invalidate).toHaveBeenCalledTimes(1);
  });

  it("quotes Hacienda's message verbatim when the event is rejected", async () => {
    const msg = "[095] El documento no se encuentra dentro del plazo de anulación";
    const c = makeDataClient({ invalidate: vi.fn(async () => { throw new FactaClientError({ code: "mh_rejected", message: msg, status: 422, retryable: false, observaciones: [msg], transport: false }); }) } as never);
    const onOpenChange = vi.fn();
    mount(<FactaInvalidateDialog session="tok" open onOpenChange={onOpenChange} />, c);
    const dialog = await screen.findByRole("dialog");
    const user = userEvent.setup();
    await user.click(await within(dialog).findByRole("button", { name: "Anular documento" }));
    expect(await within(dialog).findByText("No se pudo anular")).toBeTruthy();
    expect(within(dialog).getByText("Mensaje de Hacienda")).toBeTruthy();
    expect(within(dialog).getByText(msg)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Intentar de nuevo" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Entendido" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a transport failure can be retried safely", async () => {
    const calls: string[] = [];
    const c = makeDataClient({
      invalidate: vi.fn(async () => {
        calls.push("x");
        if (calls.length === 1) throw new FactaClientError({ code: "network_error", message: "offline", status: 0, retryable: true, transport: true });
        return { estado: "invalidado" as const, codigoGeneracion: CG1, numeroControl: "n", yaEstabaInvalidado: true };
      }),
    } as never);
    mount(<FactaInvalidateDialog session="tok" open />, c);
    const dialog = await screen.findByRole("dialog");
    const user = userEvent.setup();
    await user.click(await within(dialog).findByRole("button", { name: "Anular documento" }));
    await user.click(await within(dialog).findByRole("button", { name: "Intentar de nuevo" }));
    expect(await within(dialog).findByText("Documento anulado")).toBeTruthy();
  });

  it("an expired session says so and offers only «Cerrar»", async () => {
    const c = makeDataClient({ describeInvalidation: vi.fn(async () => { throw new FactaClientError({ code: "session_expired", message: "x", status: 401, retryable: false, transport: false }); }) } as never);
    mount(<FactaInvalidateDialog session="tok" open />, c);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Esta ventana venció/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Anular documento" })).toBeNull();
  });

  it("cancel closes without calling the API; a type 2 session shows no replacement row", async () => {
    const c = makeDataClient({ describeInvalidation: vi.fn(async () => invInfo({ invalidation: { ...invInfo().invalidation, tipoAnulacion: 2, codigoGeneracionReemplazo: null, motivo: null } })) } as never);
    const onOpenChange = vi.fn();
    mount(<FactaInvalidateDialog session="tok" open onOpenChange={onOpenChange} />, c);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Tipo de anulación");
    expect(within(dialog).queryByText("Documento de reemplazo")).toBeNull();
    expect(within(dialog).queryByText("Motivo")).toBeNull();
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(c.data.invalidate).not.toHaveBeenCalled();
  });

  it("is a bottom sheet on a phone with the danger button as the only danger action", async () => {
    phone();
    mount(<FactaInvalidateDialog session="tok" open />);
    await screen.findByRole("dialog");
    expect(document.querySelector(".facta-layer--sheet")).not.toBeNull();
    expect(document.querySelectorAll(".facta-btn--danger")).toHaveLength(1);
  });
});

describe("useFactaActions().invalidate (provider-opened dialog)", () => {
  function Trigger({ onDone, onFail }: { onDone(o: unknown): void; onFail(e: unknown): void }) {
    const actions = useFactaActions();
    return <button onClick={() => actions.invalidate("tok").then(onDone, onFail)}>abrir</button>;
  }

  it("resolves with the outcome after the person confirms", async () => {
    const onDone = vi.fn();
    mount(<Trigger onDone={onDone} onFail={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("abrir"));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Anular documento" }));
    await within(dialog).findByText("Documento anulado");
    await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ estado: "invalidado" })));
  });

  it("rejects with FactaWindowError('closed') when cancelled", async () => {
    const onFail = vi.fn();
    mount(<Trigger onDone={() => {}} onFail={onFail} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("abrir"));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(onFail).toHaveBeenCalled());
    const error = onFail.mock.calls[0]![0] as FactaWindowError;
    expect(error).toBeInstanceOf(FactaWindowError);
    expect(error.code).toBe("closed");
  });
});
