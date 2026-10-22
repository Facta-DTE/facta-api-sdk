// Examples the visitor can start from. Every value is FICTITIOUS and format-valid: the NITs and DUIs end in
// the check digit the algorithm computes (they belong to nobody that this playground knows of), names say
// «Ejemplo», e-mails end in `.example` (reserved by RFC 2606) and phone numbers use the 555 range.
// A test checks every preset against the same rules the form applies.

import type { Typed } from "./model.ts";

export interface Preset {
  id: string;
  label: string;
  icon: string;
  fields: Typed;
}

const CCF_ACTIVITY = { codActividad: "10712", descActividad: "Fabricación de pan, galletas y barquillos" };

const TAXPAYER_PRESETS: Preset[] = [
  {
    id: "empresa",
    label: "Empresa contribuyente",
    icon: "🏢",
    fields: {
      nombre: "Panadería Ejemplo La Espiga, S.A. de C.V.",
      tipoDocumento: "36",
      numDocumento: "0614-170892-101-1",
      nrc: "123456-7",
      nombreComercial: "La Espiga Ejemplo",
      ...CCF_ACTIVITY,
      departamento: "06",
      municipio: "23",
      direccion: "Calle Ejemplo #1020, Col. Flor Blanca",
      correo: "compras@laespiga.example",
      telefono: "2222-0000",
    },
  },
  {
    id: "persona",
    label: "Persona con DUI y NRC",
    icon: "👤",
    fields: {
      nombre: "Ana Ejemplo Martínez",
      tipoDocumento: "13",
      numDocumento: "01234567-8",
      nrc: "234567-8",
      codActividad: "47711",
      descActividad: "Venta al por menor de prendas de vestir y accesorios de vestir",
      departamento: "05",
      municipio: "24",
      direccion: "Residencial Ejemplo, casa 12",
      correo: "ana.ejemplo@correo.example",
      telefono: "7000-0155",
    },
  },
];

const PRESETS: Record<string, Preset[]> = {
  "01": [
    {
      id: "consumidor-dui",
      label: "Consumidor con DUI",
      icon: "👤",
      fields: { nombre: "Carlos Ejemplo Rivas", tipoDocumento: "13", numDocumento: "03945871-9", correo: "carlos.ejemplo@correo.example" },
    },
    { id: "consumidor-final", label: "Sin datos (consumidor final)", icon: "🛒", fields: {} },
  ],
  "03": TAXPAYER_PRESETS,
  "05": TAXPAYER_PRESETS,
  "06": TAXPAYER_PRESETS,
  "11": [
    {
      id: "empresa-eeuu",
      label: "Empresa en Estados Unidos",
      icon: "🏢",
      fields: {
        nombre: "Example Coffee Imports LLC",
        numDocumento: "EX-100200",
        codPais: "US",
        nombrePais: "Estados Unidos",
        complemento: "100 Example Street, Miami, FL 33101",
        tipoPersona: "2",
        descActividad: "Importación y distribución de café",
        correo: "compras@examplecoffee.example",
        telefono: "+1-305-555-0100",
      },
    },
    {
      id: "persona-guatemala",
      label: "Persona en Guatemala",
      icon: "👤",
      fields: {
        nombre: "María Ejemplo López",
        numDocumento: "GT-5550142",
        codPais: "GT",
        nombrePais: "Guatemala",
        complemento: "Zona 10, Ciudad de Guatemala",
        tipoPersona: "1",
        descActividad: "Comercio al por menor",
        correo: "maria.ejemplo@correo.example",
      },
    },
  ],
  "14": [
    {
      id: "agricultor",
      label: "Agricultor con DUI",
      icon: "🌽",
      fields: {
        nombre: "Pedro Ejemplo Hernández",
        tipoDocumento: "13",
        numDocumento: "02468135-7",
        codActividad: "01111",
        descActividad: "Cultivo de cereales excepto arroz y para forrajes",
        departamento: "07",
        municipio: "17",
        direccion: "Cantón El Ejemplo, caserío Las Flores",
      },
    },
  ],
};

/** The examples offered for a document type (empty for one that has none). */
export const presetsFor = (type: string): Preset[] => PRESETS[type] ?? [];

/** What «una factura / un crédito fiscal …» says in the box's caption. */
export const PRESET_CAPTION: Record<string, string> = {
  "01": "una factura",
  "03": "un crédito fiscal",
  "05": "una nota de crédito",
  "06": "una nota de débito",
  "11": "una factura de exportación",
  "14": "una factura de sujeto excluido",
};
