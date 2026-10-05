// Static gallery: every screen rendered from a synthetic FlowState, in a
// desktop-width card and a 390 px sheet, light and dark. Visual alignment with
// the design boards happens in a later pass; this only proves each state renders.

import { FactaRoot, FactaWindowView } from "../../../react.ts";
import { initialFlowState, type FlowState, type SessionInfo } from "../../../browser.ts";

const info: SessionInfo = {
  draft: {
    tipoDte: "01",
    receptor: { nombre: "María Fernanda López", numDocumento: "037155821", correo: "maria@example.com" },
    items: [
      { descripcion: "Café de altura, bolsa 1 lb", cantidad: 2, precioUni: 8.5 },
      { descripcion: "Pupusas revueltas", cantidad: 4, precioUni: 1.25 },
    ],
  },
  environment: "00",
  expiresAt: "2099-01-01T00:00:00Z",
  display: { total: 22, reference: "#1042", title: "Pedido #1042 · Café del Volcán" },
};

const result = {
  estado: "sellado" as const,
  codigoGeneracion: "7C2F1E5A-9B3D-4A6E-8F10-2D5B7C9E1A34",
  numeroControl: "DTE-01-M001P001-000000000000042",
  tipoDte: "01" as const,
  ambiente: "00",
  fecEmi: "2026-10-05",
  horEmi: "14:32:10",
  selloRecibido: "20267C2F1E5A9B3D4A6E8F102D5B7C9E1A34ABCD",
  totales: { totalPagar: 22.25 },
  archivoJson: "{}",
  representacionGrafica: "JVBERi0=",
  storage: { managed: "pending" as const, archive: "partial" as const },
};

const base = initialFlowState();
const failure = {
  code: "mh_rejected",
  explanation: "Hacienda revisó el documento y no lo aceptó.",
  message: "rechazado",
  retryable: false,
  spent: { numeroControl: "DTE-01-M001P001-000000000000043" },
  observaciones: ["[receptor.nrc] El valor del campo no cumple el formato requerido"],
  fields: [{ path: "receptor.nrc", message: "no cumple el formato requerido", label: "NRC del receptor" }],
  uncertain: false,
  canRetry: false,
};

const STATES: Array<[string, FlowState]> = [
  ["loading", base],
  ["review", { ...base, step: "review", info }],
  ["issuing", { ...base, step: "issuing", info, phase: "signing" }],
  ["verifying", { ...base, step: "verifying", info, attempt: 1 }],
  ["sealed", { ...base, step: "sealed", info, result }],
  ["contingency", { ...base, step: "contingency", info, result: { ...result, estado: "contingencia", detalle: "Hacienda sin servicio." } }],
  ["rejected", { ...base, step: "rejected", info, error: failure }],
  ["failed", { ...base, step: "failed", info, error: { ...failure, code: "rate_limited", explanation: "Hay demasiadas solicitudes.", retryable: true, canRetry: true, observaciones: [], fields: [], spent: null } }],
  ["expired", { ...base, step: "expired", info, error: { ...failure, code: "session_expired", observaciones: [], fields: [], spent: null } }],
];

export function Gallery() {
  return (
    <>
      {(["light", "dark"] as const).map((theme) => (
        <section key={theme}>
          <h2>Pantallas · {theme}</h2>
          <div className={theme === "dark" ? "pv-grid pv-dark" : "pv-grid"}>
            {STATES.map(([name, state]) => (
              <div key={name}>
                <FactaRoot look={{ appearance: { theme, motion: "none" } }}>
                  <FactaWindowView state={state} variant="dialog" titleId={`g-${theme}-${name}`} onClose={() => {}} />
                </FactaRoot>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h2>auto-close · cuenta regresiva (movimiento completo)</h2>
        <div className="pv-grid">
          <FactaRoot look={{ appearance: { motion: "full" } }}>
            <FactaWindowView state={STATES[4]![1]} variant="dialog" titleId="g-ac" onClose={() => {}} autoClose={{ active: true, delay: 60000, cancel() {} }} />
          </FactaRoot>
          <FactaRoot look={{ appearance: { motion: "reduced" } }}>
            <FactaWindowView state={STATES[4]![1]} variant="dialog" titleId="g-ac2" onClose={() => {}} autoClose={{ active: true, delay: 60000, cancel() {} }} />
          </FactaRoot>
        </div>
      </section>
      <section>
        <h2>Hoja en teléfono (390 px)</h2>
        <div className="pv-grid" style={{ gridTemplateColumns: "repeat(auto-fill, 390px)" }}>
          {(["review", "issuing", "sealed", "rejected"] as const).map((name) => (
            <div key={name} style={{ width: 390 }}>
              <FactaRoot look={{ appearance: { motion: "none" } }}>
                <FactaWindowView state={STATES.find(([n]) => n === name)![1]} variant="sheet" titleId={`g-sheet-${name}`} onClose={() => {}} />
              </FactaRoot>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
