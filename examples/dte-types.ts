import type { DteRequest } from "../src/types.ts";

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
    numDocumento: "06141234567890",
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
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  }],
  receptor: {
    nombre: "Commercial customer, Inc.",
    tipoDocumento: "36",
    numDocumento: "06141234567890",
  },
  items: [{ descripcion: "Returned printer", cantidad: 1, precioUni: 125 }],
};

export const debitNote: DteRequest = {
  tipoDte: "06",
  documentosRelacionados: [{
    codigoGeneracion: "7875BC7A-9580-441D-94E4-FA455E9D8BD0",
  }],
  receptor: {
    nombre: "Commercial customer, Inc.",
    tipoDocumento: "36",
    numDocumento: "06141234567890",
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
    incoterms: "FOB",
  },
  items: [{ descripcion: "Coffee beans", cantidad: 10, precioUni: 15 }],
};

export const excludedSubjectInvoice: DteRequest = {
  tipoDte: "14",
  receptor: {
    numDocumento: "06141234567890",
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
