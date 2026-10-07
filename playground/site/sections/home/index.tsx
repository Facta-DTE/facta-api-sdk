import { useEffect, type ReactNode } from "react";
import { useFactaServiceStatus } from "../../../../react.ts";
import type { ServiceState } from "../../../../browser.ts";
import { CodeBlock } from "../../code-block.tsx";
import { highlight } from "../../components/highlight.tsx";
import { Meter, StatusChip, useQuotaView } from "../../components/ui.tsx";
import { Link } from "../../router.tsx";
import { RECIPE_SPECS } from "../../../server/recipes/specs.ts";
import { usePlayground } from "../../state.tsx";
import { useDownload } from "../registro/downloads.ts";
import { lacksCurrent, money, needsEnrich, TYPE_NAMES, tail, totalOf, useRegistry, whenOf } from "../registro/registry-data.ts";
import type { RegistryDocument } from "../../api.ts";
import { LiveInvoice } from "./live-invoice.tsx";
import { SOURCES } from "../../shown-files.ts";
import { DOCS_URL, NPM_URL, PLAYGROUND_TREE_URL, REPO_URL } from "../../source-links.ts";
import packageSource from "../../../../package.json?raw";
import "./home.css";

const VERSION = /"version":\s*"([^"]+)"/.exec(packageSource)?.[1] ?? "";

// The call the floating snippet shows is the one of server/recipes/issue-idempotent.ts.
const SNIPPET = `const result = await facta.issue(request, {
  idempotencyKey: "erp-order-1042",
});
// result.selloRecibido`;

const HACIENDA: Record<ServiceState, string> = {
  online: "Hacienda en línea",
  contingency: "Hacienda en contingencia",
  degraded: "Servicio de Hacienda degradado",
  offline: "Sin respuesta de Hacienda",
};

function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "idle" }) {
  return <span className={`home-dot home-dot--${tone}`} aria-hidden />;
}

function ServiceCard() {
  const { state } = useFactaServiceStatus();
  const tone = state === "online" ? "ok" : state === "contingency" || state === "degraded" ? "warn" : state === "offline" ? "bad" : "idle";
  return (
    <section className="pg-card home-side" aria-labelledby="home-service">
      <h2 id="home-service">Servicio</h2>
      <ul className="home-service" aria-live="polite">
        <li><Dot tone={tone} />{state === null ? "Comprobando Hacienda…" : HACIENDA[state]}</li>
        <li><Dot tone={state === null ? "idle" : state === "offline" ? "bad" : "ok"} />API de Facta DTE · staging</li>
      </ul>
    </section>
  );
}

function QuotaCard() {
  const { hour, day } = useQuotaView();
  return (
    <section className="pg-card home-side" aria-labelledby="home-quota">
      <h2 id="home-quota">Su cupo de pruebas</h2>
      <p className="pg-note">Se renueva cada hora y cada día.</p>
      {hour === null || day === null ? (
        <p className="pg-note home-gap">Inicie sesión para ver cuántas emisiones le quedan.</p>
      ) : (
        <div className="home-gap">
          <Meter label="Esta hora" left={hour.left} limit={hour.limit} />
          <Meter label="Hoy" left={day.left} limit={day.limit} />
        </div>
      )}
    </section>
  );
}

/** The newest real document, or an honest example while the visitor has none. */
function HeroCard({ latest, loading }: { latest: RegistryDocument | null; loading: boolean }) {
  const { busy, download } = useDownload();
  if (latest === null) {
    return (
      <article className="home-invoice" aria-label="Ejemplo de factura sellada">
        <header><b>Factura · Consumidor final</b><span className="home-example">Ejemplo</span></header>
        <div className="home-invoice-body">
          <div className="home-row"><span>2 × Café molido 400 g</span><span>$9.00</span></div>
          <div className="home-row"><span>1 × Servicio de entrega</span><span>$3.50</span></div>
          <hr />
          <div className="home-row home-total"><span>Total</span><span>$12.50</span></div>
          <p className="pg-note">{loading ? "Buscando su última factura…" : "Así se ve una factura sellada. Emita una y aparecerá aquí con sus datos reales."}</p>
        </div>
      </article>
    );
  }
  const total = totalOf(latest);
  const sello = (latest.current as { selloRecibido?: string | null } | null)?.selloRecibido ?? null;
  return (
    <article className="home-invoice" aria-label="Su última factura de prueba">
      <header><b>{TYPE_NAMES[latest.tipoDte] ?? `Tipo ${latest.tipoDte}`}</b><StatusChip estado={latest.estado} /></header>
      <div className="home-invoice-body">
        <div className="home-row home-total"><span>Total</span><span>{total === null ? "—" : money(total)}</span></div>
        <dl className="home-ids">
          <div><dt>Número de control</dt><dd className="mono">{latest.numeroControl}</dd></div>
          <div><dt>Sello de recepción</dt><dd className="mono">{sello ?? "—"}</dd></div>
        </dl>
        <div className="home-actions">
          {([["pdf", "PDF"], ["json", "JSON DTE"], ["raw", "Raw"]] as const).map(([kind, text]) => (
            <button key={kind} type="button" className="pg-btn pg-btn--sm" disabled={busy !== null} onClick={() => void download(latest.codigoGeneracion, kind, sello)}>
              {text}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

function Recent({ documents }: { documents: RegistryDocument[] }) {
  return (
    <div className="home-table-wrap">
      <table className="home-table">
        <thead><tr><th scope="col">Hora</th><th scope="col">Documento</th><th scope="col" className="r">Total</th><th scope="col" className="r">Estado</th></tr></thead>
        <tbody>
          {documents.map((d) => {
            const total = totalOf(d);
            return (
              <tr key={d.codigoGeneracion}>
                <td>{whenOf(d)}</td>
                <td>{TYPE_NAMES[d.tipoDte] ?? d.tipoDte} · <span className="mono home-faint">{tail(d.numeroControl)}</span></td>
                <td className="r">{total === null ? "—" : money(total)}</td>
                <td className="r"><StatusChip estado={d.estado} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Integration({ pill, title, text, chip, to, cta }: { pill: string; title: string; text: ReactNode; chip: string; to: string; cta: string }) {
  return (
    <article className="pg-card home-int">
      <span className="pg-pill">{pill}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      <code className="home-chip">{chip}</code>
      <Link to={to} className="home-more">{cta} →</Link>
    </article>
  );
}

const ICONS = { react: "</>", own: "✎", server: "$_" } as const;
function PhoneLink({ to, icon, title, text }: { to: string; icon: string; title: string; text: string }) {
  return (
    <Link to={to} className="home-plink">
      <span className="home-plink-icon mono" aria-hidden>{icon}</span>
      <span><b>{title}</b><small>{text}</small></span>
      <span className="home-plink-go" aria-hidden>›</span>
    </Link>
  );
}

export function Home() {
  const { view, refresh } = usePlayground();
  const { registry, reload, enrich } = useRegistry();
  const state = view.status === "ready" ? view.state : null;
  const visitor = state?.visitor ?? null;
  const quota = state?.quota ?? null;
  const exhausted = quota !== null && !quota.allowed;
  const documents = registry.status === "ready" ? registry.documents : [];
  const latest = documents[0] ?? null;

  // Only what Inicio shows (the newest three) is ever asked about, and only when the ledger lacks it: the
  // newest one also wants its seal, which the server keeps in its cache once a document is sealed.
  useEffect(() => {
    if (registry.status !== "ready") return;
    const wanted = documents.slice(0, 3).filter((d, index) => needsEnrich(d) || (index === 0 && lacksCurrent(d))).map((d) => d.codigoGeneracion);
    if (wanted.length > 0) void enrich(wanted);
  }, [registry.status, documents, enrich]);

  return (
    <div className="pg-wrap home">
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="pg-eyebrow">SDK @facta-dte/api · {VERSION}</p>
          <h1>Pruebe el SDK emitiendo facturas de verdad</h1>
          <p className="home-lead">
            <span className="home-lead-long">Cada botón de este sitio llama al API de staging. Hacienda recibe el documento en su servicio de pruebas y usted ve el código exacto que lo hizo, listo para copiar.</span>
            <span className="home-lead-short">Cada botón llama al API de staging y le muestra el código exacto que lo hizo.</span>
          </p>
          <div className="home-cta">
            <LiveInvoice
              defaultAddress={visitor?.email ?? ""}
              signedIn={visitor !== null}
              disabled={view.status !== "ready" || visitor === null || exhausted}
              onIssued={() => { void refresh(); void reload(); }}
              secondary={<Link to="/servidor" className="pg-secondary home-cta-2">Ver recetas de servidor</Link>}
            />
          </div>
          {view.status === "ready" && visitor === null && <p className="pg-note">Inicie sesión para emitir facturas de prueba.</p>}
          {exhausted && <p className="pg-note" data-testid="quota">Límite alcanzado. Intente de nuevo más tarde.</p>}
          <p className="home-fine">Documentos sin valor fiscal. Cada emisión usa un número de control del ambiente de pruebas.</p>
        </div>

        <div className="home-hero-visual">
          <HeroCard latest={latest} loading={registry.status === "loading" && visitor !== null} />
          <pre className="home-snippet" aria-label="La llamada del SDK que emite"><code>{highlight(SNIPPET)}</code></pre>
        </div>
      </section>

      <section className="home-integrations" aria-labelledby="home-int-title">
        <h2 id="home-int-title">Tres formas de integrar, las tres en vivo</h2>
        <p className="home-sub">Elija la que se parece a su proyecto. Todas emiten contra staging con la misma llave del playground.</p>
        <div className="home-int-grid">
          <Integration pill="@facta-dte/api/react" title="Pantallas React" text="La ventana de emisión, el recibo, la lista de documentos y los selectores, listos para poner en su app." chip="<FactaInvoiceDialog session={token} />" to="/pantallas" cta="Abrir el banco de trabajo" />
          <Integration pill="@facta-dte/api/browser" title="Mi propia interfaz" text="Su diseño, su formulario, su punto de venta. El SDK solo lleva el flujo de emisión y los estados." chip="const { issue, state } = useFactaIssue(token)" to="/implementacion" cta="Ver los ejemplos" />
          <Integration pill="@facta-dte/api" title="Solo servidor" text="Sin navegador: su backend recibe un pedido y devuelve un documento sellado. Recetas que se ejecutan aquí mismo." chip="await facta.issue(venta, { idempotencyKey })" to="/servidor" cta="Ver las recetas" />
        </div>
        <p className="home-ref">
          ¿Busca un método, una opción o un código de error? <Link to="/referencia">Todo lo que puede hacer el SDK</Link>, con su explicación, su código y su guía.
        </p>
        <nav className="home-plinks" aria-label="Secciones">
          <PhoneLink to="/pantallas" icon={ICONS.react} title="Pantallas React" text="La ventana, el recibo, las listas" />
          <PhoneLink to="/implementacion" icon={ICONS.own} title="Mi propia interfaz" text="Checkout, punto de venta, CCF" />
          <PhoneLink to="/servidor" icon={ICONS.server} title="Solo servidor" text={`${RECIPE_SPECS.length} recetas que se ejecutan aquí`} />
          <PhoneLink to="/referencia" icon="{}" title="Referencia del SDK" text="Todo lo que puede hacer, buscable" />
        </nav>
      </section>

      <section className="home-bottom">
        <section className="pg-card home-recent" aria-labelledby="home-recent-title">
          <div className="home-recent-head">
            <h2 id="home-recent-title">Sus últimas facturas de prueba</h2>
            <Link to="/registro">Ver el registro</Link>
          </div>
          {visitor === null && view.status === "ready" && <p className="pg-note">Inicie sesión para ver sus documentos.</p>}
          {registry.status === "error" && <p role="alert" className="pg-error">{registry.message}</p>}
          {visitor !== null && registry.status === "ready" && documents.length === 0 && <p className="pg-note">Todavía no emitió documentos aquí. Cuando emita una factura aparecerá en esta lista.</p>}
          {documents.length > 0 && <Recent documents={documents.slice(0, 3)} />}
        </section>
        <div className="home-sides"><ServiceCard /><QuotaCard /></div>
      </section>

      <section className="pg-card home-open" aria-labelledby="home-open-title">
        <h2 id="home-open-title">Todo es código abierto</h2>
        <p className="pg-note">La librería y este mismo playground son públicos, con licencia MIT. Léalos, cópielos o propóngale cambios.</p>
        <ul className="home-open-links">
          <li><a href={REPO_URL} target="_blank" rel="noopener">Librería @facta-dte/api</a></li>
          <li><a href={PLAYGROUND_TREE_URL} target="_blank" rel="noopener">Código de este playground</a></li>
          <li><a href={NPM_URL} target="_blank" rel="noopener">Paquete en npm</a></li>
          <li><a href={DOCS_URL} target="_blank" rel="noopener">Documentación</a></li>
        </ul>
      </section>

      <section className="home-code" aria-labelledby="home-code-title">
        <h2 id="home-code-title">El código que acaba de ver correr</h2>
        <p className="pg-note">Son los archivos reales del playground, no copias: lo que ve aquí es lo que se ejecuta.</p>
        <div className="home-code-grid">
          <CodeBlock title="Navegador · sections/home/live-invoice.tsx" code={SOURCES["playground/site/sections/home/live-invoice.tsx"]} path="playground/site/sections/home/live-invoice.tsx" />
          <CodeBlock title="Servidor · server/sale.ts (arma la solicitud fiscal)" code={SOURCES["playground/server/sale.ts"]} path="playground/server/sale.ts" />
        </div>
      </section>
    </div>
  );
}
