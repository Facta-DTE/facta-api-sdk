import { useState } from "react";
import { Link } from "../../router.tsx";
import { Inline } from "./inline.tsx";
import { readRecipeTab, RECIPE_TABS, writeRecipeTab, type RecipeTab } from "./storage.ts";
import type { GuideLink, RecipeGuide } from "./types.ts";
import "./guides.css";

const TAB_LABELS: Record<RecipeTab, string> = { guia: "Cómo funciona", probar: "Probarla", codigo: "Código" };

/** The visitor's tab: the last one they used, «Cómo funciona» on the first visit. */
export function useRecipeTab(): [RecipeTab, (tab: RecipeTab) => void] {
  const [tab, setTab] = useState<RecipeTab>(() => readRecipeTab());
  const choose = (next: RecipeTab) => {
    setTab(next);
    writeRecipeTab(next);
  };
  return [tab, choose];
}

export const panelId = (recipe: string, tab: RecipeTab) => `${recipe}-panel-${tab}`;

/** «Cómo funciona · Probarla · Código», under the recipe's heading (board GuiaReceta.dc.html). */
export function RecipeTabBar({ recipe, tab, onChange, withGuide = true }: { recipe: string; tab: RecipeTab; onChange(tab: RecipeTab): void; withGuide?: boolean }) {
  const tabs = withGuide ? RECIPE_TABS : RECIPE_TABS.filter((id) => id !== "guia");
  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]!;
    onChange(next);
    (event.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="gd-tabs" role="tablist" aria-label="Vista de la receta" onKeyDown={move}>
      {tabs.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`${recipe}-tab-${id}`}
          data-tab={id}
          aria-selected={tab === id}
          aria-controls={panelId(recipe, id)}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => onChange(id)}
        >
          {TAB_LABELS[id]}
        </button>
      ))}
    </div>
  );
}

function GuideLinkItem({ link }: { link: GuideLink }) {
  if (link.to !== undefined) return <Link to={link.to}>{link.label}</Link>;
  return <a href={link.href} target="_blank" rel="noopener">{link.label}</a>;
}

/** The «Cómo funciona» pane. */
export function RecipeGuideView({ recipe, guide, hidden, onTry }: { recipe: string; guide: RecipeGuide; hidden: boolean; onTry(): void }) {
  return (
    <div className="gd" id={panelId(recipe, "guia")} role="tabpanel" aria-labelledby={`${recipe}-tab-guia`} hidden={hidden}>
      <div className="gd-col">
        <section className="gd-card" aria-labelledby={`${recipe}-g-problem`}>
          <h2 className="gd-cap" id={`${recipe}-g-problem`}>El problema</h2>
          <p><Inline text={guide.problem} /></p>
        </section>

        <section className="gd-card" aria-labelledby={`${recipe}-g-steps`}>
          <h2 className="gd-cap" id={`${recipe}-g-steps`}>Paso a paso</h2>
          <ol className="gd-steps">
            {guide.steps.map((step, index) => (
              <li key={step.title} className="gd-step">
                <span className="gd-n" aria-hidden>{index + 1}</span>
                <div>
                  <p><b>{step.title}</b> <Inline text={step.text} /></p>
                  {(step.sdk !== undefined || step.http !== undefined) && (
                    <p className="gd-chips">
                      {step.sdk?.map((call) => <code className="gd-chip" key={call}>{call}</code>)}
                      {step.http?.map((route) => <code className="gd-chip" key={route}>{route}</code>)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="gd-card" aria-labelledby={`${recipe}-g-look`}>
          <h2 className="gd-cap" id={`${recipe}-g-look`}>Qué mirar en el resultado</h2>
          <ul className="gd-list gd-list--dot">
            {guide.look.map((line) => <li key={line}><Inline text={line} /></li>)}
          </ul>
        </section>

        {guide.concepts !== undefined && guide.concepts.length > 0 && (
          <section className="gd-card" aria-labelledby={`${recipe}-g-concepts`}>
            <h2 className="gd-cap" id={`${recipe}-g-concepts`}>Conceptos que conviene tener claros</h2>
            <dl className="gd-concepts">
              {guide.concepts.map((concept) => (
                <div key={concept.title}>
                  <dt>{concept.title}</dt>
                  <dd><Inline text={concept.text} /></dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      <div className="gd-col">
        <section className="gd-card" aria-labelledby={`${recipe}-g-use`}>
          <h2 className="gd-cap" id={`${recipe}-g-use`}>Úsela cuando</h2>
          <ul className="gd-list gd-list--check">
            {guide.use.map((line) => <li key={line}><Inline text={line} /></li>)}
          </ul>
        </section>
        <div className="gd-warn" role="note"><b>No haga esto:</b> <Inline text={guide.dont} /></div>
        <div className="gd-ok" role="note"><b>La regla:</b> <Inline text={guide.rule} /></div>
        <section className="gd-card" aria-labelledby={`${recipe}-g-errors`}>
          <h2 className="gd-cap" id={`${recipe}-g-errors`}>Errores que puede ver</h2>
          {guide.errors.length === 0 && guide.noErrors !== undefined && <p><Inline text={guide.noErrors} /></p>}
          <dl className="gd-errors">
            {guide.errors.map((error) => (
              <div key={error.code}>
                <dt><code>{error.code}</code></dt>
                <dd><Inline text={error.text} /></dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="gd-card gd-card--tight" aria-labelledby={`${recipe}-g-more`}>
          <h2 className="gd-cap" id={`${recipe}-g-more`}>Más</h2>
          <ul className="gd-list gd-links">
            {guide.more.map((link) => <li key={link.label}><GuideLinkItem link={link} /></li>)}
          </ul>
          <button type="button" className="pg-primary gd-try" onClick={onTry}>Probarla ahora</button>
        </section>
      </div>
    </div>
  );
}
