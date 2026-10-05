// «Datos»: every data component of docs/react-signing-ui.md §11 against the
// in-browser mock handler, with fictional Salvadoran data.

import { useMemo, useState, type ReactNode } from "react";
import {
  FactaCustomerPicker,
  FactaDocumentDetail,
  FactaDocumentList,
  FactaDownloadButton,
  FactaProductPicker,
  FactaProvider,
  FactaServiceStatus,
  FactaStorageMeter,
  useFactaActions,
  type CustomerOption,
  type FactaAppearance,
  type FactaBranding,
  type ProductOption,
} from "../../../react.ts";
import { createMockFetch, type ListMode, type ServiceMode, type StorageMode } from "./mock-handler.ts";

const CG = "7C1E4B6A-92D3-4F08-A1B7-5E30C9D2F614";

function Mock({ children, appearance, branding, ...config }: {
  children: ReactNode;
  appearance: FactaAppearance;
  branding: FactaBranding;
  environment?: "00" | "01";
  service?: ServiceMode;
  storage?: StorageMode;
  list?: ListMode;
  exposeRecipient?: boolean;
  key?: string;
}) {
  const fetchImpl = useMemo(
    () => createMockFetch({ outcome: "sealed", environment: config.environment ?? "00", service: config.service ?? "online", storage: config.storage ?? "normal", list: config.list ?? "ok", exposeRecipient: config.exposeRecipient ?? false }),
    [config.environment, config.service, config.storage, config.list, config.exposeRecipient],
  );
  return <FactaProvider endpoint="/mock" fetch={fetchImpl} appearance={appearance} branding={branding}>{children}</FactaProvider>;
}

function InvalidateButtons() {
  const actions = useFactaActions();
  const [log, setLog] = useState("");
  const open = (token: string, label: string) =>
    actions.invalidate(token).then((o) => setLog(`${label}: anulado, sello ${o.evento?.selloRecibido.slice(0, 12)}…`), (e: Error) => setLog(`${label}: ${e.message}`));
  return (
    <p className="pv-row">
      <button onClick={() => open("inv-ok", "Anular")}>Abrir anulación</button>
      <button onClick={() => open("inv-reject", "Rechazo")}>Hacienda rechaza</button>
      <button onClick={() => open("inv-expired", "Vencida")}>Sesión vencida</button>
      <small>{log}</small>
    </p>
  );
}

function HostForm() {
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [lines, setLines] = useState<ProductOption[]>([]);
  return (
    <div className="pv-host-form">
      <h3>Nuevo pedido</h3>
      <FactaCustomerPicker value={customer} onChange={setCustomer} />
      <FactaProductPicker onSelect={(p) => setLines((l) => [...l, p])} />
      {lines.length > 0 && (
        <ul className="pv-lines">
          {lines.map((l, i) => <li key={i}><span>{l.description}</span><b>${(l.price ?? 0).toFixed(2)}</b></li>)}
        </ul>
      )}
      <small>El navegador solo recibe el id: {customer?.id ?? "—"} · productos: {lines.map((l) => l.id).join(", ") || "—"}</small>
    </div>
  );
}

export function DataSection({ appearance, branding, environment }: { appearance: FactaAppearance; branding: FactaBranding; environment: "00" | "01" }) {
  const [expose, setExpose] = useState(false);
  const [list, setList] = useState<ListMode>("ok");
  const [service, setService] = useState<ServiceMode>("online");
  const [storage, setStorage] = useState<StorageMode>("normal");
  const [detailOpen, setDetailOpen] = useState(false);
  const [n, setN] = useState(0);
  const common = { appearance, branding, environment };
  return (
    <section>
      <h2>Datos</h2>
      <div className="pv-bar pv-bar--inner">
        <label>Receptor visible<input type="checkbox" checked={expose} onChange={(e) => { setExpose(e.target.checked); setN((x) => x + 1); }} /></label>
        <label>Lista<select value={list} onChange={(e) => { setList(e.target.value as ListMode); setN((x) => x + 1); }}><option>ok</option><option>empty</option><option>error</option></select></label>
        <label>Servicio<select value={service} onChange={(e) => setService(e.target.value as ServiceMode)}><option>online</option><option>contingency</option><option>degraded</option><option>offline</option></select></label>
        <label>Almacenamiento<select value={storage} onChange={(e) => setStorage(e.target.value as StorageMode)}><option>normal</option><option>near</option><option>full</option><option>none</option></select></label>
        <button onClick={() => setN((x) => x + 1)}>Reiniciar datos</button>
      </div>

      <Mock key={`list-${n}-${expose}-${list}`} {...common} list={list} exposeRecipient={expose}>
        <h3 className="pv-h3">FactaDocumentList</h3>
        <div className="pv-surface">
          <FactaDocumentList onInvalidate={() => "inv-ok"} />
        </div>
      </Mock>

      <h3 className="pv-h3">FactaDocumentDetail</h3>
      <Mock key={`detail-${n}`} {...common} exposeRecipient={expose}>
        <p><button onClick={() => setDetailOpen(true)}>Abrir panel de detalle</button></p>
        <FactaDocumentDetail codigoGeneracion={CG} open={detailOpen} onOpenChange={setDetailOpen} onInvalidate={() => "inv-ok"} />
        <h3 className="pv-h3">En línea, junto a la página</h3>
        <div style={{ maxWidth: 520 }}><FactaDocumentDetail presentation="inline" codigoGeneracion={CG} /></div>
      </Mock>

      <h3 className="pv-h3">FactaDownloadButton</h3>
      <Mock key={`dl-${n}`} {...common}>
        <div className="pv-row pv-surface pv-pad">
          <FactaDownloadButton codigoGeneracion={CG} />
          <FactaDownloadButton codigoGeneracion={CG} variant="outline" />
          <FactaDownloadButton codigoGeneracion={CG} variant="outline" size="sm" />
          <FactaDownloadButton codigoGeneracion={CG} variant="icon" />
        </div>
      </Mock>

      <h3 className="pv-h3">FactaCustomerPicker · FactaProductPicker</h3>
      <Mock key={`pk-${n}-${expose}`} {...common} exposeRecipient={expose}>
        <div className="pv-surface pv-pad"><HostForm /></div>
      </Mock>

      <h3 className="pv-h3">FactaServiceStatus</h3>
      <div className="pv-row pv-surface pv-pad">
        <Mock key={`svc-${service}`} {...common} service={service}><FactaServiceStatus /></Mock>
        <Mock key={`svcd-${service}`} {...common} service={service}><FactaServiceStatus variant="dot" /></Mock>
        {(["online", "contingency", "offline"] as ServiceMode[]).map((s) => (
          <Mock key={s} {...common} service={s}><FactaServiceStatus /></Mock>
        ))}
      </div>

      <h3 className="pv-h3">FactaStorageMeter</h3>
      <div className="pv-grid">
        {(["normal", "near", "full", "none"] as StorageMode[]).map((s) => (
          <Mock key={s} {...common} storage={s}><FactaStorageMeter /></Mock>
        ))}
      </div>

      <h3 className="pv-h3">FactaInvalidateDialog (useFactaActions().invalidate)</h3>
      <Mock key={`inv-${n}`} {...common}><InvalidateButtons /></Mock>
    </section>
  );
}
