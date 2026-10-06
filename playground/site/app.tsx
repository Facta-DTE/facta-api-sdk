import { useEffect, useState } from "react";
import { FactaProvider } from "../../react.ts";
import { Link, Router, useRoute } from "./router.tsx";
import { SECTIONS } from "./sections/registry.ts";
import { playgroundFetch } from "./api.ts";
import { clearRateLimit, RATE_LIMIT_BANNER, useRateLimited } from "./rate-limit.ts";
import { StateProvider, usePlayground } from "./state.tsx";
import { QuotaMeter, Wordmark, initials, useQuotaView } from "./components/ui.tsx";

import { DOCS_URL, LICENSE_URL, NPM_URL, PLAYGROUND_TREE_URL, REPO_URL } from "./source-links.ts";

const EXTERNAL = { target: "_blank", rel: "noopener" } as const;

function Nav() {
  const { path } = useRoute();
  return (
    <nav className="pg-nav" aria-label="Secciones">
      {SECTIONS.map((section) => (
        <Link key={section.path} to={section.path} aria-current={path === section.path ? "page" : undefined}>
          {section.label}
        </Link>
      ))}
    </nav>
  );
}

function Visitor() {
  const { visitor } = useQuotaView();
  return (
    <span className="pg-avatar" role="img" aria-label={visitor === null ? "Sin sesión" : `Visitante ${visitor.label}`} title={visitor?.label}>
      {visitor === null ? "–" : initials(visitor.email ?? visitor.label)}
    </span>
  );
}

const MENU_ICON = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
const BACK_ICON = <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>;

/** Phone header: Inicio carries the brand and the menu; every other section a back arrow and its name. */
function PhoneBar() {
  const { path, navigate } = useRoute();
  const [open, setOpen] = useState(false);
  const section = SECTIONS.find((s) => s.path === path) ?? SECTIONS[0]!;
  const home = section.path === "/";
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="pg-mbar">
      {home ? (
        <Link to="/" className="pg-brand" aria-label="Playground de Facta DTE, inicio">
          <Wordmark />
          <span className="pg-brand-name">playground</span>
        </Link>
      ) : (
        <>
          <button type="button" className="pg-back" aria-label="Volver a Inicio" onClick={() => navigate("/")}>{BACK_ICON}</button>
          <span className="pg-mtitle">{section.label}</span>
        </>
      )}
      <span className="pg-env-chip">staging</span>
      {home && (
        <button type="button" className="pg-menu-toggle" aria-label="Menú" aria-expanded={open} aria-controls="pg-menu" onClick={() => setOpen((v) => !v)}>{MENU_ICON}</button>
      )}
      {open && (
        <nav id="pg-menu" className="pg-menu" aria-label="Secciones">
          {SECTIONS.map((s) => <Link key={s.path} to={s.path} aria-current={path === s.path ? "page" : undefined}>{s.label}</Link>)}
          <a href={DOCS_URL}>Documentación</a>
          <a href={REPO_URL} {...EXTERNAL}>Código fuente</a>
          <QuotaMeter />
        </nav>
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="pg-header">
      <div className="pg-header-inner">
        <Link to="/" className="pg-brand" aria-label="Playground de Facta DTE, inicio">
          <Wordmark />
          <span className="pg-brand-sep" aria-hidden />
          <span className="pg-brand-name">playground</span>
        </Link>
        <span className="pg-env-chip">staging · ambiente 00</span>
        <Nav />
        <div className="pg-header-tools">
          <QuotaMeter />
          <a className="pg-doc-link" href={DOCS_URL}>Documentación</a>
          <a className="pg-doc-link" href={REPO_URL} {...EXTERNAL}>Código fuente</a>
          <Visitor />
        </div>
      </div>
      <PhoneBar />
    </header>
  );
}

function Banner() {
  const { view } = usePlayground();
  const limited = useRateLimited();
  if (limited) {
    return (
      <div role="status" className="pg-banner pg-banner--limit" data-testid="rate-limit-banner">
        <span>{RATE_LIMIT_BANNER}</span>
        <button type="button" onClick={clearRateLimit}>Entendido</button>
      </div>
    );
  }
  if (view.status === "blocked") {
    return (
      <div role="alert" className="pg-banner pg-banner--blocked">
        <strong>El playground está detenido.</strong> {view.message}
      </div>
    );
  }
  if (view.status === "ready" && view.state.visitor?.via === "dev-bypass") {
    return <div className="pg-banner">Modo de desarrollo local: la verificación de Cloudflare Access está omitida en este equipo.</div>;
  }
  return null;
}

/** Licence and the public repository, on every page. */
function SiteFooter() {
  return (
    <footer className="pg-footer">
      <span>Facta DTE · SDK de código abierto, licencia <a href={LICENSE_URL} {...EXTERNAL}>MIT</a></span>
      <nav aria-label="Código abierto">
        <a href={REPO_URL} {...EXTERNAL}>Librería @facta-dte/api</a>
        <a href={PLAYGROUND_TREE_URL} {...EXTERNAL}>Código de este playground</a>
        <a href={NPM_URL} {...EXTERNAL}>Paquete en npm</a>
        <a href={DOCS_URL}>Documentación</a>
      </nav>
    </footer>
  );
}

function Page() {
  const { path } = useRoute();
  const section = SECTIONS.find((s) => s.path === path) ?? SECTIONS[0]!;
  return <main id="contenido"><section.Component /></main>;
}

export function App() {
  return (
    <Router>
      <StateProvider>
        <FactaProvider endpoint="/api/facta" fetch={playgroundFetch} appearance={{ theme: "light", variables: { accent: "#1677a8", accentInk: "#ffffff", accentSoft: "#e3f1f8" } }} branding={{ name: "Playground Facta DTE" }}>
          <a className="pg-skip" href="#contenido">Saltar al contenido</a>
          <Header />
          <Banner />
          <Page />
          <SiteFooter />
        </FactaProvider>
      </StateProvider>
    </Router>
  );
}
