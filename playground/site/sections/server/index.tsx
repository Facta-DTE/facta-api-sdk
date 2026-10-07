import { useCallback, useEffect, useState } from "react";
import { useRoute } from "../../router.tsx";
import { RECIPE_SPECS } from "../../../server/recipes/specs.ts";
import { RecipePanel } from "./recipe-panel.tsx";
import { OrderWebhookPanel } from "./order-webhook-panel.tsx";
import { loadMine, type MyDocument } from "./recipes-api.ts";
import { RECIPE_SHORT_TITLES, RECIPE_SUBTITLES } from "./subtitles.ts";
import "./recipes.css";

// Solo servidor: fixed recipes (server/recipes/*.ts) the Worker runs against staging with
// parameters from a validated form. Visitors never send code.
export function ServerRecipes() {
  const [selected, setSelected] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get("receta");
    return RECIPE_SPECS.some((s) => s.id === wanted) ? wanted! : RECIPE_SPECS[0]!.id;
  });
  const [mine, setMine] = useState<MyDocument[]>([]);
  // A link from another recipe's guide to this route carries a new `?receta=`.
  const { visits } = useRoute();
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("receta");
    if (visits > 0 && RECIPE_SPECS.some((s) => s.id === wanted)) setSelected(wanted!);
  }, [visits]);

  useEffect(() => {
    void loadMine().then((docs) => setMine((current) => merge(docs, current)));
  }, []);
  const onIssued = useCallback((docs: MyDocument[]) => setMine((current) => merge(docs, current)), []);

  const choose = (id: string) => {
    setSelected(id);
    window.history.replaceState(null, "", `${window.location.pathname}?receta=${id}`);
  };
  const index = RECIPE_SPECS.findIndex((s) => s.id === selected);
  const spec = RECIPE_SPECS[index]!;

  return (
    <div className="srv">
      <nav className="srv-rail" aria-label="Recetas">
        <h2 className="srv-rail-title">Recetas</h2>
        {RECIPE_SPECS.map((s, i) => (
          <button type="button" key={s.id} className="srv-rail-item" aria-current={s.id === selected ? "true" : undefined} onClick={() => choose(s.id)}>
            <span className="srv-num" aria-hidden>{i + 1}</span>
            <span>
              <b>{RECIPE_SHORT_TITLES[s.id] ?? s.title}</b>
              <small>{RECIPE_SUBTITLES[s.id] ?? ""}</small>
            </span>
          </button>
        ))}
      </nav>
      <div className="srv-select">
        <label className="pg-field">
          <span>Receta</span>
          <select value={selected} onChange={(event) => choose(event.target.value)}>
            {RECIPE_SPECS.map((s, i) => <option key={s.id} value={s.id}>{i + 1} · {RECIPE_SHORT_TITLES[s.id] ?? s.title}</option>)}
          </select>
        </label>
      </div>
      {spec.id === "order-webhook"
        ? <OrderWebhookPanel key={spec.id} spec={spec} number={index + 1} mine={mine} onIssued={onIssued} />
        : <RecipePanel key={spec.id} spec={spec} number={index + 1} mine={mine} onIssued={onIssued} />}
    </div>
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
