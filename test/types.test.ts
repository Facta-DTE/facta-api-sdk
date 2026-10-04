import { assertEquals } from "jsr:@std/assert@1";
import {
  creditFiscalInvoice,
  creditNote,
  debitNote,
  excludedSubjectInvoice,
  exportInvoice,
  finalConsumerInvoice,
  namedFinalConsumerInvoice,
} from "../examples/dte-types.ts";
import type {
  RelatedDocument,
  ListedDte,
  ListDocumentsFilters,
  DteRequest,
  DteType,
} from "../mod.ts";

const requests: DteRequest[] = [
  { tipoDte: "01", items: [{ descripcion: "FE", cantidad: 1, precioUni: 1 }] },
  {
    tipoDte: "03",
    receptor: { nombre: "Cliente" },
    items: [{ descripcion: "CCF", cantidad: 1, precioUni: 1 }],
  },
  {
    tipoDte: "05",
    documentosRelacionados: [{ codigoGeneracion: "gen-05" }],
    items: [{ descripcion: "NC", cantidad: 1, precioUni: 1 }],
  },
  {
    tipoDte: "06",
    documentosRelacionados: [{ codigoGeneracion: "gen-06" }],
    numPagoElectronico: "TRF-1",
    items: [{ descripcion: "ND", cantidad: 1, precioUni: 1 }],
  },
  {
    tipoDte: "11",
    receptor: {
      nombre: "Foreign buyer",
      numDocumento: "TAX-1",
      codPais: "US",
      nombrePais: "United States",
      complemento: "Miami",
      tipoPersona: 2,
      descActividad: "Product import",
      correo: "buyer@example.com",
    },
    exportacion: { tipoItemExpor: 1 },
    items: [{ descripcion: "Export", cantidad: 1, precioUni: 1 }],
  },
  {
    tipoDte: "14",
    receptor: {
      nombre: "Supplier",
      numDocumento: "061234567",
      direccion: {
        departamento: "06",
        municipio: "20",
        complemento: "San Miguel",
      },
    },
    aplicarReteRenta: false,
    items: [{ descripcion: "Service", cantidad: 1, precioUni: 1 }],
  },
];

const shortRelatedDocument: RelatedDocument = {
  codigoGeneracion: "generation-code",
};
const fullRelatedDocument: RelatedDocument = {
  tipoDocumento: "03",
  numeroDocumento: "CCF-1",
  fechaEmision: "2026-09-30",
  tipoGeneracion: 1,
};
const supported: DteType[] = ["01", "03", "05", "06", "11", "14"];
const listFilters: ListDocumentsFilters[] = [{ estado: "sellado" }, { estado: "invalidado" }];
const listedDocumentState: ListedDte["estado"] = "contingencia";
const unavailableListedReceiver: ListedDte["receptor"] = null;
const documentedExamples: DteRequest[] = [
  finalConsumerInvoice,
  namedFinalConsumerInvoice,
  creditFiscalInvoice,
  creditNote,
  debitNote,
  exportInvoice,
  excludedSubjectInvoice,
];

// @ts-expect-error export invoices require both a foreign recipient and export block
const incompleteExport: DteRequest = { tipoDte: "11", items: [] };
// @ts-expect-error payment transfer reference is only accepted for debit notes
const paymentReferenceOnInvoice: DteRequest = {
  tipoDte: "01",
  numPagoElectronico: "TRF-1",
  items: [],
};
// @ts-expect-error note references must use either short or full form
const incompleteRelatedDocument: RelatedDocument = { tipoDocumento: "03" };
// @ts-expect-error rejected reservations are queried by generation code, not listed from dte_index
const rejectedListFilter: ListDocumentsFilters = { estado: "rechazado" };
// @ts-expect-error the list endpoint cannot return a rejected reservation row
const rejectedListedDocument: ListedDte = { estado: "rechazado", codigoGeneracion: "x", numeroControl: "y", tipoDte: "01", fecEmi: "2026-10-01" };

void [
  shortRelatedDocument,
  fullRelatedDocument,
  supported,
  incompleteExport,
  paymentReferenceOnInvoice,
  incompleteRelatedDocument,
  listFilters,
  listedDocumentState,
  unavailableListedReceiver,
  rejectedListFilter,
  rejectedListedDocument,
];
Deno.test("all API DTE request variants are represented by the public SDK types", () => {
  assertEquals(requests.map((request) => request.tipoDte), supported);
  assertEquals(
    [...new Set(documentedExamples.map((request) => request.tipoDte))],
    supported,
  );
});
