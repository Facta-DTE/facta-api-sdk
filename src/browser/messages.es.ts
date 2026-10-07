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
  autoClose: { closingIn: string };
  downloads: { pdfHint: string; jsonHint: string; jsonRawHint: string };
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
    stepStates: { done: string; active: string; pending: string };
    takesAFewSeconds: string;
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
    downloadJsonRaw: string;
    done: string;
    copy: string;
    copied: string;
    copyLabel: string;
    observations: string;
  };
  contingency: { headline: string; body: string; detail: string; warningTitle: string; warningBody: string; signedAt: string };
  rejected: {
    headline: string;
    quoteHeading: string;
    intro: string;
    spent: string;
    spentUnknown: string;
    fixInSystem: string;
    fieldsHeading: string;
    close: string;
  };
  failed: {
    headline: string;
    retry: string;
    close: string;
    detailLabel: string;
    uncertainTitle: string;
    uncertainBody: string;
    codeLabel: string;
    fieldsHeading: string;
    fixInSystem: string;
  };
  expired: { headline: string; body: string; close: string };
  /** Banner for a document with no permanent storage (the emergency safeguard ran). */
  emergency: { saved: string; failed: string };
  storage: { label: string; saved: string; pending: string; off: string; pendingHelp: string; offHelp: string; savedHelp: string };
  /** Delivery rows (e-mail / WhatsApp) on finished documents. */
  delivery: {
    /** Row label per channel. */
    label: { correo: string; whatsapp: string };
    /** Channel as a noun phrase, for «Enviando {channel}…». */
    channel: { correo: string; whatsapp: string };
    sending: string;
    sent: { correo: string; whatsapp: string };
    failed: { correo: string; whatsapp: string };
    /** Whole-row text for states with their own wording. {channel} is filled. */
    states: Record<string, string>;
    /** After the polling budget ran out. */
    later: string;
    /** Readable text per reason code; `default` when the code is unknown. */
    reasons: Record<string, string>;
    /**
     * Help under a sending limit or provider outage (`quota_exceeded`,
     * `provider_unavailable`), which is shown as a warning, never as an error.
     */
    limitHelp?: string;
  };
  button: {
    label: string;
    working: string;
    done: string;
    contingency: string;
    failed: string;
    details: string;
    close: string;
    /** Short footer of the result popover. */
    attribution: string;
  };
  status: Record<string, string>;
  /** Data components (lists, detail, pickers, status, meter, invalidation). */
  data: {
    list: {
      title: string;
      inPeriod: string;
      refresh: string;
      period: string;
      allTypes: string;
      allStates: string;
      searchPlaceholder: string;
      searchLoadedNote: string;
      clearFilters: string;
      filters: string;
      from: string;
      to: string;
      columns: { date: string; type: string; control: string; receiver: string; total: string; status: string };
      receiverHidden: string;
      finalConsumer: string;
      actions: string;
      showing: string;
      loadMore: string;
      loadingMore: string;
      empty: { title: string; body: string };
      noMatches: { title: string; body: string };
      error: { title: string; body: string; retry: string };
      apply: string;
      close: string;
    };
    menu: {
      pdf: string;
      json: string;
      ticket: string;
      copyCode: string;
      codeCopied: string;
      detail: string;
      invalidate: string;
    };
    detail: {
      label: string;
      total: string;
      identifiers: string;
      code: string;
      control: string;
      seal: string;
      totals: string;
      taxed: string;
      exempt: string;
      notSubject: string;
      discount: string;
      iva: string;
      grandTotal: string;
      receiver: string;
      receiverHidden: string;
      receiverHiddenHelp: string;
      observations: string;
      invalidate: string;
      copies: { heading: string; facta: string; saved: string; pending: string; failed: string; retry: string; retrying: string; none: string; json: string; pdf: string };
      timeline: {
        heading: string;
        issued: string;
        sealed: string;
        sealedHelp: string;
        contingency: string;
        contingencyHelp: string;
        waiting: string;
        invalidated: string;
        invalidatedHelp: string;
      };
      loading: string;
      error: string;
      retry: string;
      close: string;
    };
    download: {
      pdf: string;
      json: string;
      ticket: string;
      more: string;
      preparing: string;
      done: string;
      formats: string;
      pdfHint: string;
      jsonHint: string;
      jsonRaw: string;
      jsonRawHint: string;
      ticketHint: string;
      failed: string;
    };
    picker: {
      customerLabel: string;
      customerPlaceholder: string;
      productLabel: string;
      productPlaceholder: string;
      typeMore: string;
      searching: string;
      empty: string;
      emptyHelp: string;
      error: string;
      keys: { navigate: string; chooseCustomer: string; chooseProduct: string; close: string };
      remove: string;
      vatIncluded: string;
      vatExcluded: string;
      results: string;
    };
    service: {
      online: string;
      contingency: string;
      degraded: string;
      offline: string;
      checking: string;
      contingencyHelp: string;
      degradedHelp: string;
      offlineHelp: string;
      onlineHelp: string;
    };
    meter: {
      title: string;
      of: string;
      usedPercent: string;
      free: string;
      noneFree: string;
      near: { title: string; body: string };
      full: { title: string; body: string };
      none: { title: string; body: string };
      unavailable: string;
      retry: string;
    };
    invalidate: {
      label: string;
      confirm: { title: string; body: string };
      progress: { title: string; body: string };
      success: { title: string; body: string };
      error: { title: string; body: string; hacienda: string };
      readOnly: string;
      type: string;
      types: { "1": string; "2": string; "3": string };
      replacement: string;
      reason: string;
      responsible: string;
      requester: string;
      irreversible: { title: string; body: string };
      steps: { signing: string; sending: string; saving: string };
      eventSeal: string;
      submit: string;
      working: string;
      cancel: string;
      close: string;
      viewDetail: string;
      understood: string;
      loading: string;
      expired: string;
    };
  };
  /** The compact receipt card. */
  receipt: { sealedPill: string };
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
    sealed: "Emisión completada",
    contingency: "Emisión en espera",
    rejected: "Emisión rechazada",
    failed: "No se pudo emitir",
    expired: "Ventana vencida",
  },
  autoClose: { closingIn: "Se cerrará en {n} s" },
  downloads: { pdfHint: "Representación gráfica", jsonHint: "Archivo DTE con sello", jsonRawHint: "Tal como se guardó" },
  chipTest: "Pruebas",
  closeLabel: "Cerrar ventana",
  footerBrand: "Powered by factadte.com",
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
    stepStates: { done: "Listo", active: "En curso…", pending: "En espera" },
    takesAFewSeconds: "Esto toma unos segundos.",
    doNotClose: "No cierre esta ventana.",
    status: "Paso {n} de 3: {label}",
  },
  verifying: {
    body: "Estamos confirmando con Hacienda. No cierre esta ventana.",
    attempt: "Intento {n} de {total}",
  },
  sealed: {
    headline: "Factura emitida",
    total: "Total emitido",
    controlNumber: "Número de control",
    generationCode: "Código de generación",
    seal: "Sello de recepción",
    dateTime: "Fecha y hora",
    downloadPdf: "Descargar PDF",
    downloadJson: "Descargar JSON",
    downloadJsonRaw: "JSON original (raw)",
    done: "Listo",
    copy: "Copiar",
    copied: "Copiado",
    copyLabel: "Copiar {label}",
    observations: "Observaciones de Hacienda",
  },
  contingency: {
    headline: "Factura firmada, pendiente de Hacienda",
    body:
      "Su factura quedó firmada y Facta DTE la transmitirá a Hacienda en cuanto el servicio responda. No necesita hacer nada más.",
    detail: "Detalle",
    warningTitle: "No vuelva a emitir este documento.",
    warningBody: "Si lo hace, el cliente recibiría dos facturas por el mismo pedido.",
    signedAt: "Firmada",
  },
  rejected: {
    headline: "Hacienda rechazó el documento",
    quoteHeading: "Lo que dijo Hacienda",
    intro: "El documento no pasó la validación. Este dato debe corregirse en su sistema:",
    spent:
      "Este rechazo usó el número de control {numeroControl}. Al corregir el documento en su sistema, puede volver a usar ese mismo número.",
    spentUnknown:
      "Este rechazo usó un número de control. Al corregir el documento en su sistema, puede volver a usar ese mismo número.",
    fixInSystem: "Corrija el dato en su sistema y vuelva a abrir la ventana.",
    fieldsHeading: "Datos que hay que corregir",
    close: "Cerrar",
  },
  failed: {
    headline: "No pudimos emitir su factura",
    retry: "Intentar de nuevo",
    close: "Cerrar",
    detailLabel: "Detalle",
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
  emergency: {
    saved: "Este documento no quedó en un almacenamiento permanente; se guardó en el respaldo de emergencia. Puede descargarlo también ahora.",
    failed: "Este documento no quedó en un almacenamiento permanente y el respaldo de emergencia no lo guardó: descárguelo ahora.",
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
  delivery: {
    label: { correo: "Entrega por correo", whatsapp: "Entrega por WhatsApp" },
    channel: { correo: "correo", whatsapp: "WhatsApp" },
    sending: "Enviando {channel}…",
    sent: { correo: "Correo enviado a {to}", whatsapp: "WhatsApp enviado a {to}" },
    failed: { correo: "No se pudo enviar el correo", whatsapp: "No se pudo enviar el WhatsApp" },
    states: {
      sin_credito: "Sin saldo de WhatsApp",
      sin_consentimiento: "Sin consentimiento del cliente",
      no_permitido: "El permiso de la llave no incluye {channel}",
      vencido: "El plazo para enviar venció",
      esperando_sello: "Se enviará cuando Hacienda confirme el documento",
    },
    later: "Consultaremos el estado más tarde",
    reasons: {
      smtp_rejected: "El servidor de correo lo rechazó",
      invalid_address: "Dirección rechazada",
      wallet_empty: "Sin saldo de WhatsApp",
      provider_unavailable: "El proveedor no respondió",
      quota_exceeded: "Se alcanzó el límite de envíos",
      default: "Intente reenviarlo desde su sistema",
    },
    limitHelp: "El documento ya está emitido; descargue el PDF o el JSON y compártalo, o reintente más tarde.",
  },
  button: {
    label: "Emitir factura",
    working: "Emitiendo…",
    done: "Emitida",
    contingency: "Firmada",
    failed: "No se emitió",
    details: "Ver detalle",
    close: "Cerrar detalle",
    attribution: "factadte.com",
  },
  receipt: { sealedPill: "Sellada" },
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
  data: {
    list: {
      title: "Documentos",
      inPeriod: "{n} en el período",
      refresh: "Actualizar",
      period: "Período",
      allTypes: "Todos los tipos",
      allStates: "Todos los estados",
      searchPlaceholder: "Buscar por número de control",
      searchLoadedNote: "La búsqueda recorre los documentos ya cargados.",
      clearFilters: "Limpiar filtros",
      filters: "Filtros",
      from: "Desde",
      to: "Hasta",
      columns: { date: "Fecha", type: "Tipo", control: "Número de control", receiver: "Receptor", total: "Total", status: "Estado" },
      receiverHidden: "Oculto",
      finalConsumer: "Consumidor final",
      actions: "Acciones",
      showing: "Mostrando {shown}",
      loadMore: "Cargar más",
      loadingMore: "Cargando…",
      empty: {
        title: "Todavía no hay documentos en este período",
        body: "Cuando emita una factura aparecerá aquí. También puede ampliar las fechas o quitar filtros.",
      },
      noMatches: {
        title: "Ningún documento coincide",
        body: "Pruebe con otro número o cargue más documentos.",
      },
      error: {
        title: "No pudimos cargar los documentos",
        body: "Su conexión con Facta falló. Sus documentos no se perdieron.",
        retry: "Reintentar",
      },
      apply: "Ver documentos",
      close: "Cerrar filtros",
    },
    menu: {
      pdf: "Descargar PDF",
      json: "Descargar JSON",
      ticket: "Ticket 80 mm",
      copyCode: "Copiar código de generación",
      codeCopied: "Código copiado",
      detail: "Ver detalle",
      invalidate: "Anular documento",
    },
    detail: {
      label: "Detalle del documento",
      total: "Total a pagar",
      identifiers: "Identificadores",
      code: "Código de generación",
      control: "Número de control",
      seal: "Sello de recepción",
      totals: "Totales",
      taxed: "Gravado",
      exempt: "Exento",
      notSubject: "No sujeto",
      discount: "Descuento",
      iva: "IVA",
      grandTotal: "Total",
      receiver: "Receptor",
      receiverHidden: "Oculto en esta vista",
      receiverHiddenHelp: "Su sistema decide si el navegador puede ver el receptor.",
      observations: "Observaciones de Hacienda",
      invalidate: "Anular",
      copies: {
        heading: "Copias",
        facta: "Facta",
        saved: "Guardadas",
        pending: "Pendiente",
        failed: "Con error",
        retry: "Reintentar",
        retrying: "Reintentando…",
        none: "Aún no hay copias de este documento.",
        json: "JSON",
        pdf: "PDF",
      },
      timeline: {
        heading: "Historial",
        issued: "Emitida",
        sealed: "Sellada por Hacienda",
        sealedHelp: "Recepción inmediata",
        contingency: "Emitida en contingencia",
        contingencyHelp: "Hacienda no respondió; el documento quedó firmado",
        waiting: "Esperando el sello de Hacienda",
        invalidated: "Invalidada",
        invalidatedHelp: "El documento ya no es válido",
      },
      loading: "Cargando el documento…",
      error: "No pudimos cargar este documento.",
      retry: "Reintentar",
      close: "Cerrar detalle",
    },
    download: {
      pdf: "Descargar PDF",
      json: "Descargar JSON",
      ticket: "Descargar ticket",
      more: "Más formatos",
      preparing: "Preparando {kind}…",
      done: "{kind} descargado",
      formats: "Formato",
      pdfHint: "Carta",
      jsonHint: "Archivo DTE con sello",
      jsonRaw: "JSON original (raw)",
      jsonRawHint: "Tal como se guardó",
      ticketHint: "Térmica",
      failed: "No se pudo descargar",
    },
    picker: {
      customerLabel: "Cliente",
      customerPlaceholder: "Buscar cliente por nombre o documento",
      productLabel: "Producto",
      productPlaceholder: "Buscar producto por código o nombre",
      typeMore: "Escriba al menos {n} caracteres",
      searching: "Buscando…",
      empty: "Sin resultados para «{query}»",
      emptyHelp: "Revise la ortografía o busque por número de documento.",
      error: "No pudimos buscar en este momento.",
      keys: { navigate: "↑↓ navegar", chooseCustomer: "Enter elegir", chooseProduct: "Enter agregar", close: "Esc cerrar" },
      remove: "Quitar selección",
      vatIncluded: "IVA incluido",
      vatExcluded: "Más IVA",
      results: "{n} resultados",
    },
    service: {
      online: "Hacienda en línea",
      contingency: "Hacienda en contingencia",
      degraded: "Servicio con avisos",
      offline: "Sin conexión con Facta",
      checking: "Comprobando…",
      onlineHelp: "Sus documentos se envían a Hacienda en el momento.",
      contingencyHelp:
        "Hacienda no responde. Sus documentos se firman y quedan en cola; se enviarán solos cuando vuelva el servicio, dentro del plazo legal.",
      degradedHelp: "Facta responde, pero hay algo por revisar en la configuración de su cuenta.",
      offlineHelp: "No hay conexión con Facta. No se pueden emitir documentos hasta que vuelva.",
    },
    meter: {
      title: "Almacenamiento de Facta",
      of: "{used} de {total}",
      usedPercent: "{n} % usado",
      free: "{free} libres",
      noneFree: "Sin espacio libre",
      near: { title: "Le queda poco espacio", body: "Quedan {free}. Amplíe el plan antes de que se llene." },
      full: {
        title: "El almacenamiento de Facta está lleno",
        body: "Facta no podrá guardar copias nuevas hasta que amplíe el plan. Sus destinos propios siguen recibiendo cada documento.",
      },
      none: {
        title: "Sus documentos se guardan solo en sus propios destinos.",
        body: "Si desea que Facta también conserve una copia, actívelo desde su cuenta.",
      },
      unavailable: "No pudimos leer el almacenamiento.",
      retry: "Reintentar",
    },
    invalidate: {
      label: "Anular documento",
      confirm: { title: "Anular documento", body: "Revise los datos. Su sistema los preparó; aquí no se pueden cambiar." },
      progress: { title: "Anulando…", body: "No cierre esta ventana hasta terminar." },
      success: { title: "Documento anulado", body: "Hacienda aceptó la anulación el {date}." },
      error: { title: "No se pudo anular", body: "El documento sigue vigente.", hacienda: "Mensaje de Hacienda" },
      readOnly: "Preparado por su sistema · solo lectura",
      type: "Tipo de anulación",
      types: {
        "1": "Error en la información, se reemplaza por otro documento",
        "2": "Rescindir la operación",
        "3": "Otro",
      },
      replacement: "Documento de reemplazo",
      reason: "Motivo",
      responsible: "Responsable",
      requester: "Solicitante",
      irreversible: {
        title: "La anulación no se puede deshacer",
        body: "Hacienda registrará el evento y el documento quedará invalidado para siempre.",
      },
      steps: { signing: "Firmando el evento de anulación", sending: "Enviando a Hacienda", saving: "Guardando la copia del evento" },
      eventSeal: "Sello del evento",
      submit: "Anular documento",
      working: "Anulando…",
      cancel: "Cancelar",
      close: "Cerrar",
      viewDetail: "Ver detalle",
      understood: "Entendido",
      loading: "Cargando los datos de la anulación…",
      expired: "Esta ventana venció. Vuelva a abrirla desde su sistema.",
    },
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
    not_sealed: "El documento todavía no tiene sello de Hacienda; use raw para el original.",
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
