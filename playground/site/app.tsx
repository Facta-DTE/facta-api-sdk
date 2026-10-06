import { FactaProvider } from "../../react.ts";
import { Link, Router, useRoute } from "./router.tsx";
import { SECTIONS } from "./sections/registry.ts";
import { mockFetch } from "./api.ts";
import { StateProvider, usePlayground } from "./state.tsx";

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

function Banner() {
  const { view } = usePlayground();
  if (view.status === "blocked") {
    return (
      <div role="alert" className="pg-banner pg-banner--blocked">
        <strong>El playground está detenido.</strong> {view.message}
      </div>
    );
  }
  if (view.status === "ready" && view.state.visitor?.via === "dev-bypass") {
    return <div className="pg-banner">Modo de desarrollo local: Cloudflare Access está omitido en este equipo.</div>;
  }
  return null;
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
        <FactaProvider endpoint="/api/facta" fetch={mockFetch()} appearance={{ theme: "auto" }} branding={{ name: "Playground Facta DTE" }}>
          <a className="pg-skip" href="#contenido">Saltar al contenido</a>
          <header className="pg-header">
            <Link to="/" className="pg-brand" aria-label="Playground de Facta DTE, inicio">
              <span className="pg-mark" aria-hidden />
              <span>Facta DTE <small>playground</small></span>
            </Link>
            <Nav />
          </header>
          <Banner />
          <Page />
          <footer className="pg-footer">
            Ambiente de pruebas (00). Los documentos no tienen valor fiscal. · <a href="https://sdk.factadte.com">Documentación del SDK</a>
          </footer>
        </FactaProvider>
      </StateProvider>
    </Router>
  );
}
