// Every string the signing window shows (es-SV, addressing the person as
// «usted»). Hacienda's own messages are never translated; they are quoted.
//
// Any key can be overridden with a partial object. `{name}` placeholders are
// filled by `fill()`.

import type { DteType } from "../types.ts";

export interface FactaMessages {
  title: {
    loading: string;
    review: string;
    issuing: string;
    verifying: string;
    sealed: string;
    contingency: string;
    rejected: string;
    failed: string;
    expired: string;
  };
  chipTest: string;
  closeLabel: string;
  footerBrand: string;
  dialogLabel: string;
  docTypes: Record<DteType, string>;
  review: {
    recipientHeading: string;
    finalConsumer: string;
    linesHeading: string;
    total: string;
    totalNote: string;
    issue: string;
    cancel: string;
    reference: string;
  };
  issuing: {
    steps: { preparing: string; signing: string; sending: string };
    doNotClose: string;
    status: string;
  };
  verifying: { body: string; attempt: string };
  sealed: {
    headline: string;
    total: string;
    controlNumber: string;
    generationCode: string;
    seal: string;
    dateTime: string;
    downloadPdf: string;
    downloadJson: string;
    done: string;
    copy: string;
    copied: string;
    copyLabel: string;
    observations: string;
  };
  contingency: { headline: string; body: string; detail: string };
  rejected: {
    headline: string;
    quoteHeading: string;
    spent: string;
    fieldsHeading: string;
    close: string;
  };
  failed: {
    headline: string;
    retry: string;
    close: string;
    uncertainTitle: string;
    uncertainBody: string;
    codeLabel: string;
    fieldsHeading: string;
    fixInSystem: string;
  };
  expired: { headline: string; body: string; close: string };
  storage: { label: string; saved: string; pending: string; off: string; pendingHelp: string; offHelp: string; savedHelp: string };
  button: {
    label: string;
    working: string;
    done: string;
    contingency: string;
    failed: string;
    details: string;
    close: string;
  };
  status: Record<string, string>;
  /** Labels for the fields Hacienda or the handler can point at. */
  fieldLabels: Record<string, string>;
  /** Scope suffixes: «del receptor», «de la línea {n}». */
  fieldScopes: { receptor: string; line: string; document: string; issuer: string };
  /** Explanation per error code (FactaErrorCode + handler codes). */
  errors: Record<string, string>;
  /** Fallback when a code has no entry. */
  genericError: string;
}

export const esMessages: FactaMessages = {
  title: {
    loading: "Cargando su factura",
    review: "Revise su factura",
    issuing: "Emitiendo su factura",
    verifying: "Verificando con Hacienda",
    sealed: "Factura emitida",
    contingency: "Pendiente de Hacienda",
    rejected: "Hacienda rechazó el documento",
    failed: "No se pudo emitir",
    expired: "Ventana vencida",
  },
  chipTest: "Pruebas",
  closeLabel: "Cerrar ventana",
  footerBrand: "Emitido con Facta DTE",
  dialogLabel: "Emisión de factura",
  docTypes: {
    "01": "Factura",
    "03": "Crédito fiscal",
    "05": "Nota de crédito",
    "06": "Nota de débito",
    "11": "Factura de exportación",
    "14": "Sujeto excluido",
  },
  review: {
    recipientHeading: "Receptor",
    finalConsumer: "Consumidor final",
    linesHeading: "Detalle",
    total: "Total de su pedido",
    totalNote: "Hacienda calcula los totales definitivos al sellar.",
    issue: "Emitir factura",
    cancel: "Cancelar",
    reference: "Pedido {reference}",
  },
  issuing: {
    steps: {
      preparing: "Preparando el documento",
      signing: "Firmando",
      sending: "Enviando a Hacienda",
    },
    doNotClose: "No cierre esta ventana.",
    status: "Paso {n} de 3: {label}",
  },
  verifying: {
    body: "Estamos confirmando con Hacienda. No cierre esta ventana.",
    attempt: "Intento {n} de {total}",
  },
  sealed: {
    headline: "Factura emitida",
    total: "Total a pagar",
    controlNumber: "Número de control",
    generationCode: "Código de generación",
    seal: "Sello de recepción",
    dateTime: "Fecha y hora",
    downloadPdf: "Descargar PDF",
    downloadJson: "Descargar JSON",
    done: "Listo",
    copy: "Copiar",
    copied: "Copiado",
    copyLabel: "Copiar {label}",
    observations: "Observaciones de Hacienda",
  },
  contingency: {
    headline: "Factura firmada, pendiente de Hacienda",
    body:
      "Su documento quedó firmado y se transmitirá a Hacienda en cuanto el servicio responda. No lo emita de nuevo: ya existe y es válido.",
    detail: "Detalle",
  },
  rejected: {
    headline: "Hacienda rechazó el documento",
    quoteHeading: "Lo que dijo Hacienda",
    spent: "Se usó el número de control {numeroControl}.",
    fieldsHeading: "Datos que hay que corregir",
    close: "Cerrar",
  },
  failed: {
    headline: "No pudimos emitir su factura",
    retry: "Intentar de nuevo",
    close: "Cerrar",
    uncertainTitle: "No pudimos confirmar el resultado",
    uncertainBody:
      "No vuelva a emitir este documento: pudo haberse emitido. Revise el estado desde su pedido o comuníquese con quien le atiende.",
    codeLabel: "Código",
    fieldsHeading: "Datos que hay que corregir",
    fixInSystem: "Corrija estos datos en su pedido y vuelva a emitir desde ahí.",
  },
  expired: {
    headline: "Esta ventana venció.",
    body: "Vuelva a abrirla desde su pedido.",
    close: "Cerrar",
  },
  storage: {
    label: "Copias",
    saved: "Guardadas",
    pending: "Guardándose…",
    off: "Sin copia automática",
    savedHelp: "Las copias de respaldo del documento están guardadas.",
    pendingHelp:
      "El servidor de quien le atiende completa las copias de respaldo por su cuenta. No afecta la validez de la factura.",
    offHelp: "Este servicio no guarda copias automáticas de los documentos.",
  },
  button: {
    label: "Emitir factura",
    working: "Emitiendo…",
    done: "Emitida",
    contingency: "Firmada",
    failed: "No se emitió",
    details: "Ver detalle",
    close: "Cerrar detalle",
  },
  status: {
    sellado: "Sellado",
    contingencia: "En contingencia",
    rechazado: "Rechazado",
    firmado: "Firmado",
    invalidado: "Invalidado",
    reservado: "Reservado",
    liberado: "Liberado",
    descartado: "Descartado",
    preparado: "Preparado",
  },
  fieldLabels: {
    nombre: "Nombre",
    nit: "NIT",
    nrc: "NRC",
    numDocumento: "Número de documento",
    tipoDocumento: "Tipo de documento",
    codActividad: "Código de actividad",
    descActividad: "Actividad económica",
    direccion: "Dirección",
    departamento: "Departamento",
    municipio: "Municipio",
    complemento: "Dirección",
    telefono: "Teléfono",
    correo: "Correo",
    nombreComercial: "Nombre comercial",
    descripcion: "Descripción",
    cantidad: "Cantidad",
    precioUni: "Precio",
    montoDescu: "Descuento",
    uniMedida: "Unidad de medida",
    tipoItem: "Tipo de ítem",
    codigo: "Código",
    formaPago: "Forma de pago",
    condicionOperacion: "Condición de la operación",
    observaciones: "Observaciones",
    codPais: "País",
    nombrePais: "País",
  },
  fieldScopes: {
    receptor: "{label} del receptor",
    line: "{label} de la línea {n}",
    document: "{label} del documento",
    issuer: "{label} del emisor",
  },
  errors: {
    unauthorized: "No tiene permiso para emitir desde esta ventana.",
    invalid_api_key: "La conexión con Facta DTE no está bien configurada. Avise a quien administra el sistema.",
    key_revoked: "La conexión con Facta DTE fue revocada. Avise a quien administra el sistema.",
    key_expired: "La conexión con Facta DTE venció. Avise a quien administra el sistema.",
    key_inactive: "La conexión con Facta DTE está inactiva. Avise a quien administra el sistema.",
    forbidden_scope: "La conexión con Facta DTE no permite esta operación.",
    dte_type_not_allowed: "Este tipo de documento no está habilitado para su cuenta.",
    ip_not_allowed: "La conexión con Facta DTE no admite el servidor desde el que se emite.",
    environment_not_allowed: "El ambiente de esta cuenta no permite esta operación.",
    sign_key_required: "Falta la clave de firma. Avise a quien administra el sistema.",
    sign_key_invalid: "La clave de firma no es correcta. Avise a quien administra el sistema.",
    sign_vault_locked: "La firma no está disponible en este momento. Avise a quien administra el sistema.",
    sign_vault_missing: "Aún no hay un certificado de firma configurado para esta cuenta.",
    invalid_request: "Los datos del documento no son válidos.",
    validation_failed: "Los datos del documento no cumplen los requisitos de Hacienda. Revise la información e intente de nuevo.",
    not_found: "No encontramos el documento.",
    method_not_allowed: "La operación no está disponible.",
    idempotency_key_required: "Falta la clave de idempotencia del pedido.",
    idempotency_key_reuse: "Este pedido ya se envió con datos distintos. Vuelva a abrirlo desde su pedido.",
    idempotency_in_flight: "Este documento todavía se está procesando.",
    prepare_token_invalid: "El documento preparado ya no es válido. Vuelva a empezar.",
    rate_limited: "Hay demasiadas solicitudes en este momento. Espere unos segundos e intente de nuevo.",
    amount_limit: "El monto supera el límite permitido para esta cuenta.",
    mh_rejected: "Hacienda revisó el documento y no lo aceptó.",
    mh_unreachable: "No pudimos comunicarnos con Hacienda en este momento.",
    correlative_unavailable: "No hay un número de control disponible por ahora. Intente de nuevo en unos minutos.",
    service_unavailable: "El servicio no está disponible en este momento. Intente de nuevo en unos minutos.",
    no_storage_destination: "La cuenta no tiene un destino de almacenamiento configurado.",
    storage_unsupported: "El destino de almacenamiento no admite este documento.",
    storage_unavailable: "El almacenamiento no está disponible en este momento.",
    storage_contract_invalid: "El documento se emitió, pero su copia de respaldo no se pudo confirmar.",
    internal_error: "Ocurrió un error inesperado. Intente de nuevo en unos minutos.",
    operation_outcome_unknown: "No pudimos confirmar el resultado de la operación.",
    archive_integrity_error: "El archivo del documento no pasó la verificación de integridad.",
    network_error: "No hay conexión con el servicio.",
    session_invalid: "Esta ventana no es válida. Vuelva a abrirla desde su pedido.",
    session_expired: "Esta ventana venció. Vuelva a abrirla desde su pedido.",
    action_not_allowed: "Esta acción no está permitida en esta ventana.",
    recipient_invalid: "Los datos fiscales no son válidos. Revíselos e intente de nuevo.",
    bad_request: "No se pudo procesar la solicitud.",
  },
  genericError: "Ocurrió un problema al procesar su factura.",
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K] };

/** A partial override of any message; unspecified keys keep the Spanish default. */
export type FactaMessagesOverride = DeepPartial<FactaMessages>;

/** Merge an override over the Spanish defaults (one level deep, plus `submitting.steps`). */
export function mergeMessages(override?: FactaMessagesOverride | null): FactaMessages {
  if (!override) return esMessages;
  const out = structuredClone(esMessages) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const base = out[key];
    if (value && typeof value === "object" && base && typeof base === "object") {
      const next = { ...(base as Record<string, unknown>) };
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const inner = next[k];
        next[k] = v && typeof v === "object" && inner && typeof inner === "object"
          ? { ...(inner as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v;
      }
      out[key] = next;
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as unknown as FactaMessages;
}

/** Fill `{name}` placeholders. Unknown names stay visible rather than vanishing. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole
  );
}

/** Spanish explanation for an error code. */
export function explainError(code: string, messages: FactaMessages = esMessages): string {
  return messages.errors[code] ?? messages.genericError;
}
