import type { DteRequest } from "@facta-dte/api";

export const finalConsumerInvoice: DteRequest = {
  tipoDte: "01",
  items: [{ descripcion: "Coffee", cantidad: 2, precioUni: 1.5 }],
};

export const namedFinalConsumerInvoice: DteRequest = {
  tipoDte: "01",
  receptor: {
    nombre: "Walk-in customer",
    correo: "customer@example.com",
  },
  items: [{ descripcion: "Coffee", cantidad: 2, precioUni: 1.5 }],
};

export const creditFiscalInvoice: DteRequest = {
  tipoDte: "03",
  receptor: {
    nombre: "Commercial customer, Inc.",
    tipoDocumento: "36",
    numDocumento: "TEST-RECIPIENT-ID",
    nrc: "1234567",
    codActividad: "46510",
    descActividad: "Wholesale trade of equipment",
    direccion: {
      departamento: "06",
      municipio: "20",
      complemento: "Downtown, San Miguel",
    },
    correo: "purchases@example.com",
  },
  items: [{ descripcion: "Office printer", cantidad: 1, precioUni: 125 }],
};

export const creditNote: DteRequest = {
  tipoDte: "05",
  documentosRelacionados: [{
    codigoGeneracion: "REPLACE_WITH_ISSUER_OWNED_SEALED_DOCUMENT",
  }],
  receptor: {
    nombre: "Commercial customer, Inc.",
    tipoDocumento: "36",
    numDocumento: "TEST-RECIPIENT-ID",
  },
  items: [{ descripcion: "Returned printer", cantidad: 1, precioUni: 125 }],
};

export const debitNote: DteRequest = {
  tipoDte: "06",
  documentosRelacionados: [{
    codigoGeneracion: "REPLACE_WITH_ISSUER_OWNED_SEALED_DOCUMENT",
  }],
  receptor: {
    nombre: "Commercial customer, Inc.",
    tipoDocumento: "36",
    numDocumento: "TEST-RECIPIENT-ID",
  },
  items: [{ descripcion: "Additional service", cantidad: 1, precioUni: 10 }],
  numPagoElectronico: "POS-2048",
};

export const exportInvoice: DteRequest = {
  tipoDte: "11",
  receptor: {
    nombre: "Overseas buyer LLC",
    numDocumento: "US-998877",
    codPais: "US",
    nombrePais: "United States",
    complemento: "Miami, Florida",
    tipoPersona: 2,
    descActividad: "Import and distribution",
    correo: "buyer@example.com",
    telefono: null,
  },
  exportacion: {
    tipoItemExpor: 1,
    incoterms: "09", // CAT-031 code (the description is filled in by the server)
    // Goods: Hacienda requires these three even though its schema marks them optional.
    recintoFiscal: "02", // CAT-027: Marítima de Acajutla
    tipoRegimen: "EX-1", // CAT-033: definitive export
    regimen: "1000.000", // CAT-028
  },
  items: [{ descripcion: "Coffee beans", cantidad: 10, precioUni: 15 }],
};

export const excludedSubjectInvoice: DteRequest = {
  tipoDte: "14",
  receptor: {
    numDocumento: "TEST-RECIPIENT-ID",
    nombre: "Excluded subject",
    tipoDocumento: "36",
    codActividad: "47111",
    direccion: {
      departamento: "06",
      municipio: "20",
      complemento: "Downtown, San Miguel",
    },
    correo: "excluded@example.com",
  },
  aplicarReteRenta: false,
  items: [{ descripcion: "Local service", cantidad: 1, precioUni: 50 }],
};

/** Remission note (04): goods move without a sale. `receptor.bienTitulo` (CAT-025) is required and has no default. */
export const remissionNote: DteRequest = {
  tipoDte: "04",
  receptor: {
    nombre: "Commercial customer, Inc.",
    tipoDocumento: "36",
    numDocumento: "TEST-RECIPIENT-ID",
    nrc: "1234567",
    codActividad: "46510",
    direccion: {
      departamento: "06",
      municipio: "20",
      distrito: "01",
      complemento: "Warehouse 2, San Miguel",
    },
    correo: "warehouse@example.com",
    bienTitulo: "04", // CAT-025: transfer
  },
  // Optional: the sealed 01, 03 or 11 the goods travel with.
  // documentosRelacionados: [{ codigoGeneracion: "REPLACE_WITH_ISSUER_OWNED_SEALED_DOCUMENT" }],
  items: [{ descripcion: "Box of spare parts", cantidad: 2, precioUni: 25, tipoItem: 1 }],
};

/**
 * Retention receipt (07): only for a company designated as a retention agent (otherwise `403 retention_agent_required`).
 * Each line is a withholding, not a sale: no quantity or unit price. The first references an electronic CCF;
 * the second is a paper purchase (no reference) under `C9`, which requires `ivaRetenido`.
 */
export const retentionReceipt: DteRequest = {
  tipoDte: "07",
  receptor: {
    nombre: "Supplier, Inc.",
    tipoDocumento: "36",
    numDocumento: "TEST-RECIPIENT-ID",
    nrc: "1234567",
    codActividad: "46510",
    direccion: {
      departamento: "06",
      municipio: "20",
      distrito: "01",
      complemento: "Downtown, San Miguel",
    },
    correo: "supplier@example.com",
  },
  items: [
    {
      tipoDte: "03",
      numeroDocumento: "REPLACE_WITH_THE_CCF_GENERATION_CODE",
      fechaEmision: "2026-10-05",
      montoSujetoGrav: 1000,
      codigoRetencionMH: "22", // CAT-006: 1 %, computed by the server
    },
    { montoSujetoGrav: 250.5, codigoRetencionMH: "C9", ivaRetenido: 2.5, descripcion: "Paper purchase" },
  ],
};
