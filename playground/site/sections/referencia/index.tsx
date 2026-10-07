import { useEffect, useMemo, useState } from "react";
import { CodeBlock } from "../../code-block.tsx";
import { Link } from "../../router.tsx";
import { SOURCES, type SourcePath } from "../../shown-files.ts";
import { githubFileUrl } from "../../source-links.ts";
import { RECIPE_SPECS } from "../../../server/recipes/specs.ts";
import {
  COVERAGE, GROUPS, GUIDES, PORTAL_BASE, groupOf, keysCoveredBy, searchTextOf,
  type CoverageEntry, type Demo, type GroupId,
} from "../../../shared/sdk-coverage.ts";
import { demoCounts, displayNames, guideLinks, statusOf } from "./view.ts";
import "./referencia.css";

// Section «Referencia del SDK»: every capability of @facta-dte/api in one searchable page, each with what it does,
// where it runs live (or why it does not), the code and its guides. The data is `shared/sdk-coverage.ts`, which a test
// checks against the package's real exports, so nothing the SDK can do is missing from here.
const ALL = "todas";

function readQuery(): { q: string; group: string } {
  const params = new URLSearchParams(window.location.search);
  return { q: params.get("q") ?? "", group: params.get("grupo") ?? ALL };
}

/** Keeps the address in step with the filters, so a search can be shared. */
function writeQuery(q: string, group: string) {
  const params = new URLSearchParams();
  if (q.trim() !== "") params.set("q", q.trim());
  if (group !== ALL) params.set("grupo", group);
  const search = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${search === "" ? "" : `?${search}`}${window.location.hash}`);
}

export function Referencia() {
  const initial = useMemo(readQuery, []);
  const [q, setQ] = useState(initial.q);
  const [group, setGroup] = useState<string>(GROUPS.some((g) => g.id === initial.group) ? initial.group : ALL);
  const counts = useMemo(() => demoCounts(COVERAGE), []);
  const total = useMemo(() => new Set(COVERAGE.flatMap((e) => e.covers)).size, []);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = COVERAGE.filter((entry) => (group === ALL || entry.group === group) && words.every((w) => searchTextOf(entry).includes(w)));
  const byGroup = new Map<GroupId, number>();
  for (const entry of COVERAGE) if (words.every((w) => searchTextOf(entry).includes(w))) byGroup.set(entry.group, (byGroup.get(entry.group) ?? 0) + 1);

  useEffect(() => writeQuery(q, group), [q, group]);
  // A link to #entry opens on that card.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id !== "") window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, []);

  return (
    <div className="rf">
      <nav className="rf-rail" aria-label="Grupos de la referencia">
        <h2 className="rf-rail-title">Grupos</h2>
        <button type="button" className="rf-rail-item" aria-current={group === ALL ? "true" : undefined} onClick={() => setGroup(ALL)}>
          <span>Todo</span><small>{[...byGroup.values()].reduce((a, b) => a + b, 0)}</small>
        </button>
        {GROUPS.map((g) => (
          <button type="button" key={g.id} className="rf-rail-item" aria-current={group === g.id ? "true" : undefined} onClick={() => setGroup(g.id)} disabled={(byGroup.get(g.id) ?? 0) === 0}>
            <span>{g.label}</span><small>{byGroup.get(g.id) ?? 0}</small>
          </button>
        ))}
      </nav>

      <div className="rf-main">
        <header className="rf-head">
          <p className="pg-eyebrow">@facta-dte/api · {total} elementos públicos</p>
          <h1>Todo lo que puede hacer el SDK</h1>
          <p className="rf-lead">
            Cada capacidad del paquete, con su explicación, el código y la forma de verla funcionar. Si el SDK puede hacerlo, está aquí: lo que corre en
            vivo tiene su demostración; lo que no, dice por qué. Esta lista se compara con las exportaciones reales del paquete en cada cambio, así que no
            queda nada por adivinar.
          </p>
          <ul className="rf-legend" aria-label="Cómo se muestra cada capacidad">
            <li><b>{counts.live}</b> se pueden ejecutar o ver en vivo</li>
            <li><b>{counts.simulated}</b> con una simulación segura</li>
            <li><b>{counts.documented}</b> solo documentadas, con su motivo</li>
          </ul>
          <p className="rf-notice" role="note">
            <b>Clientes y productos:</b> el SDK también puede crearlos, editarlos y desactivarlos, y está documentado más abajo. El playground no modifica el
            catálogo: su servidor rechaza cualquier intento con un 403 («Disponible en el SDK; el playground no modifica el catálogo.»).
          </p>
          <div className="rf-search">
            <label htmlFor="rf-q">Buscar una capacidad, un método, una opción o un código de error</label>
            <input id="rf-q" type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Por ejemplo: archivoDte, región, idempotencyKey, return_window_closed" autoComplete="off" spellCheck={false} />
          </div>
          <div className="rf-select">
            <label htmlFor="rf-g">Grupo</label>
            <select id="rf-g" value={group} onChange={(event) => setGroup(event.target.value)}>
              <option value={ALL}>Todos los grupos</option>
              {GROUPS.map((g) => <option key={g.id} value={g.id} disabled={(byGroup.get(g.id) ?? 0) === 0}>{g.label} ({byGroup.get(g.id) ?? 0})</option>)}
            </select>
          </div>
          <p className="rf-count" role="status">{shown.length === COVERAGE.length ? `${shown.length} capacidades` : `${shown.length} de ${COVERAGE.length} capacidades`}</p>
        </header>

        {shown.length === 0 && (
          <p className="pg-note">Ninguna capacidad coincide con «{q}». Pruebe con otra palabra o <button type="button" className="rf-link" onClick={() => { setQ(""); setGroup(ALL); }}>quite los filtros</button>.</p>
        )}

        {GROUPS.filter((g) => shown.some((e) => e.group === g.id)).map((g) => (
          <section key={g.id} className="rf-group" aria-labelledby={`g-${g.id}`}>
            <h2 id={`g-${g.id}`}>{g.label}</h2>
            <p className="rf-group-blurb">{g.blurb}</p>
            {shown.filter((e) => e.group === g.id).map((entry) => <Card key={entry.id} entry={entry} />)}
          </section>
        ))}
      </div>
    </div>
  );
}

function Card({ entry }: { entry: CoverageEntry }) {
  const [code, setCode] = useState(false);
  const [more, setMore] = useState(false);
  const status = statusOf(entry.demo);
  const names = useMemo(() => displayNames(entry), [entry]);
  const head = names.slice(0, 8);
  const rest = names.slice(8);
  const links = guideLinks(entry);
  return (
    <article id={entry.id} className="rf-card" aria-labelledby={`t-${entry.id}`}>
      <div className="rf-card-top">
        <span className="rf-group-tag">{groupOf(entry.group).label}</span>
        <span className={`rf-status rf-status--${status.tone}`}>{status.label}</span>
      </div>
      <h3 id={`t-${entry.id}`}>{entry.title}</h3>
      <p className="rf-summary">{entry.summary}</p>

      {names.length > 0 && (
        <div className="rf-covers" aria-label="Lo que cubre">
          {head.map((n) => <code key={n}>{n}</code>)}
          {rest.length > 0 && !more && <button type="button" className="rf-link" onClick={() => setMore(true)}>y {rest.length} más</button>}
          {more && rest.map((n) => <code key={n}>{n}</code>)}
        </div>
      )}

      <DemoBox demo={entry.demo} />

      <div className="rf-code">
        <button type="button" className="rf-code-toggle" aria-expanded={code} onClick={() => setCode((v) => !v)}>
          {code ? "Ocultar el código" : entry.code.kind === "file" ? "Ver el código que se ejecuta" : "Ver un ejemplo de código"}
        </button>
        {code && <Shown entry={entry} />}
      </div>

      <footer className="rf-links">
        {links.guides.map((g) => <a key={g.stem} href={g.href} target="_blank" rel="noopener">Guía: {g.title}</a>)}
        {links.portal.map((p) => <a key={p} href={`${PORTAL_BASE}${p}`} target="_blank" rel="noopener">sdk.factadte.com{p}</a>)}
        {links.sources.map((s) => <a key={s} href={githubFileUrl(s)} target="_blank" rel="noopener" className="mono">{s}</a>)}
      </footer>
    </article>
  );
}

function Shown({ entry }: { entry: CoverageEntry }) {
  if (entry.code.kind === "file") {
    const path = entry.code.path as SourcePath;
    return <CodeBlock title={`Ejecutado · ${path.replace(/^playground\//, "")}`} code={SOURCES[path]} path={path} />;
  }
  return <CodeBlock title={entry.code.label} code={entry.code.text} />;
}

function DemoBox({ demo }: { demo: Demo }) {
  if (demo.kind === "documented") {
    return (
      <div className="rf-demo rf-demo--documented">
        <b>Solo documentado.</b> <span>{demo.reason}</span>
      </div>
    );
  }
  if (demo.kind === "page") {
    return (
      <div className="rf-demo rf-demo--live">
        <Link to={demo.path} className="rf-demo-link">{demo.label}</Link>
        {demo.note !== undefined && <span>{demo.note}</span>}
      </div>
    );
  }
  const spec = RECIPE_SPECS.find((s) => s.id === demo.recipe);
  const simulated = demo.kind === "simulated";
  return (
    <div className={`rf-demo ${simulated ? "rf-demo--simulated" : "rf-demo--live"}`}>
      <Link to={`/servidor?receta=${demo.recipe}`} className="rf-demo-link">{simulated ? "Ver la simulación" : "Ejecutar en staging"}{spec === undefined ? "" : ` · ${spec.title}`}</Link>
      <span>{simulated ? demo.note : demo.note ?? "Corre en el servidor del playground contra el ambiente de pruebas."}</span>
    </div>
  );
}

export { keysCoveredBy };
