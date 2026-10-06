import { useCallback, useEffect, useState } from "react";
import { RECIPE_SPECS } from "../../../server/recipes/specs.ts";
import { RecipePanel } from "./recipe-panel.tsx";
import { loadMine, type MyDocument } from "./recipes-api.ts";
import "./recipes.css";

// Solo servidor: fixed recipes (server/recipes/*.ts) the Worker runs against staging with
// parameters from a validated form. Visitors never send code.
export function ServerRecipes() {
  const [selected, setSelected] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get("receta");
    return RECIPE_SPECS.some((s) => s.id === wanted) ? wanted! : RECIPE_SPECS[0]!.id;
  });
  const [mine, setMine] = useState<MyDocument[]>([]);

  useEffect(() => {
    void loadMine().then((docs) => setMine((current) => merge(docs, current)));
  }, []);
  const onIssued = useCallback((docs: MyDocument[]) => setMine((current) => merge(docs, current)), []);

  const choose = (id: string) => {
    setSelected(id);
    window.history.replaceState(null, "", `${window.location.pathname}?receta=${id}`);
  };
  const spec = RECIPE_SPECS.find((s) => s.id === selected)!;

  return (
    <section className="pg-page">
      <header className="pg-hero">
        <p className="pg-eyebrow">Solo servidor · ambiente de pruebas</p>
        <h1>Recetas para integrar Facta DTE desde su servidor</h1>
        <p className="pg-lead">
          Cada receta es un archivo real: lo ve completo y lo puede ejecutar aquí contra el ambiente de pruebas.
          Usted solo escribe los parámetros; la llave vive en el servidor del playground.
        </p>
      </header>
      <div className="pg-recipes">
        <nav className="pg-recipe-nav" aria-label="Recetas">
          {RECIPE_SPECS.map((s) => (
            <button type="button" key={s.id} aria-current={s.id === selected ? "true" : undefined} onClick={() => choose(s.id)}>{s.title}</button>
          ))}
        </nav>
        <RecipePanel key={spec.id} spec={spec} mine={mine} onIssued={onIssued} />
      </div>
    </section>
  );
}

function merge(incoming: MyDocument[], current: MyDocument[]): MyDocument[] {
  const seen = new Set<string>();
  const out: MyDocument[] = [];
  for (const d of [...incoming, ...current]) {
    const key = d.codigoGeneracion.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}
