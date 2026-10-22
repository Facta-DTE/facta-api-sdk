// Recipe 16 · The emergency safeguard, SIMULATED.
//
// Facta keeps every sealed document in a one-hour holding copy while it is written to durable storage. If the
// server says it could not store the document anywhere durable (the warning codes `sin_almacenamiento_duradero`,
// `sin_copia_en_servidor`, `copia_solo_temporal`), or every replication failed, that copy is the only one left.
// `runtime.emergencyStore` is YOUR function, called once per document in that case and never otherwise: it
// receives the Archivo DTE, the stored original JSON, the PDF and what happened, and writes them somewhere you own.
// It is optional (without it, Facta e-mails the company owner a backup), it never turns a sealed document into an
// error, and the SDK ships no storage of its own.
//
// PART 1 is the code you would write. PART 2 is a playground harness: an in-memory «Facta API» that answers a sealed
// document with the warning you pick, so you can see the function being called. It touches no network and no storage:
// the playground never calls the real emergency path, and nothing here is written anywhere.
import { Facta, type EmergencyFiles, type EmergencyInfo, type EmergencyReport } from "../../../mod.ts";

// ---- PART 1 · What you write ---------------------------------------------------------------------------------
export interface Received {
  info: EmergencyInfo;
  files: { archivoDteBytes: number | null; jsonRawBytes: number; pdfBytes: number | null };
}

/** Your store. Here it only remembers what it received; in production it writes the three files to YOUR storage. */
export function makeStore(received: Received[], fails: boolean) {
  return async (files: EmergencyFiles, info: EmergencyInfo): Promise<void> => {
    if (fails) throw new Error("the destination is unreachable"); // the SDK reports `store_failed`, the result is unchanged
    received.push({
      info,
      files: {
        archivoDteBytes: files.archivoDte === undefined ? null : files.archivoDte.length,
        jsonRawBytes: files.jsonRaw.length,
        pdfBytes: files.pdf === null ? null : files.pdf.byteLength,
      },
    });
  };
}

// ---- PART 2 · Playground harness (simulation) -----------------------------------------------------------------
export type Scenario = "sin_almacenamiento_duradero" | "sin_copia_en_servidor" | "copia_solo_temporal";

export interface Input {
  scenario: Scenario;
  /** Make your function throw, to see `store_failed`. */
  storeFails: boolean;
  /** Do not configure `emergencyStore`, to see `not_configured`. */
  notConfigured: boolean;
}

const SIMULATED_CODE = "00000000-0000-4000-8000-00000000e001";
const SIMULATED_PDF = btoa("%PDF-1.4 simulated");

/** An API that never leaves this process: it answers one sealed document that carries the warning. */
function simulatedApi(scenario: Scenario): typeof fetch {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = new URL(String(input)).pathname;
    if (method === "POST" && path.endsWith("/v1/dte")) {
      return json({
        estado: "sellado",
        codigoGeneracion: SIMULATED_CODE,
        numeroControl: "DTE-01-M001P001-000000000000000",
        tipoDte: "01",
        ambiente: "00",
        fecEmi: "2026-10-07",
        horEmi: "10:00:00",
        selloRecibido: "SELLO-SIMULADO",
        jws: "simulado.simulado.simulado",
        documento: { identificacion: { codigoGeneracion: SIMULATED_CODE } },
        archivoDte: JSON.stringify({ identificacion: { codigoGeneracion: SIMULATED_CODE }, firmaElectronica: "simulado", selloRecibido: "SELLO-SIMULADO" }, null, 2),
        archivoJson: JSON.stringify({ codigoGeneracion: SIMULATED_CODE, ambiente: "00", jws: "simulado.simulado.simulado" }),
        representacionGrafica: SIMULATED_PDF,
        totales: { totalPagar: 1 },
        observaciones: [],
        advertencias: [{ codigo: scenario, mensaje: "Advertencia simulada por el playground." }],
      });
    }
    return json({ error: { code: "not_found", message: "simulated" } });
  }) as typeof fetch;
}

export async function run(_facta: Facta, input: Input): Promise<{ simulated: true; report: EmergencyReport | null; calledYourFunction: Received[]; sdkWarnings: unknown }> {
  const received: Received[] = [];
  const simulated = new Facta({
    apiKey: "facta_test_simulada",
    signKey: "factask_simulada",
    baseUrl: "https://api.simulada.invalid/v1",
    fetch: simulatedApi(input.scenario),
    region: false, // no discovery request
    clock: false,
    maxRetries: 0,
    runtime: {
      version: 1,
      ...(input.notConfigured ? {} : { emergencyStore: makeStore(received, input.storeFails) }),
    },
  });
  const result = await simulated.issue({ tipoDte: "01", items: [{ descripcion: "Simulación", cantidad: 1, precioUni: 1 }] });
  return { simulated: true, report: result.emergency ?? null, calledYourFunction: received, sdkWarnings: result.sdkWarnings ?? [] };
}

export const sample: Input = { scenario: "sin_almacenamiento_duradero", storeFails: false, notConfigured: false };
