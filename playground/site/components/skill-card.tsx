import { SKILL_GITHUB_URL, SKILL_ZIP_URL } from "../source-links.ts";
import "./skill-card.css";

// «Skill para su agente de IA»: a card in the style of Inicio's integration cards (pg-card, pg-pill, the grey
// command chip, pg-primary / pg-secondary buttons), used on Inicio and, compact, at the top of Referencia.
// The zip is a static asset of the Worker; the link to GitHub is a constant in source-links.ts.
export const INSTALL_UNZIP = "unzip facta-dte-api-skill.zip -d ~/.claude/skills/";
export const INSTALL_ASK = "Abra una sesión nueva y pida: «integra Facta DTE en este proyecto».";

export function SkillCard({ variant = "full" }: { variant?: "full" | "compact" }) {
  return (
    <section className={`pg-card skill-card skill-card--${variant}`} aria-labelledby={`skill-title-${variant}`} data-testid="skill-card">
      <span className="pg-pill">skills/facta-dte-api</span>
      <h2 id={`skill-title-${variant}`}>Skill para su agente de IA</h2>
      <p>
        Una skill instalable que le enseña a su agente de código (Claude Code y otros) a integrar Facta DTE sin adivinar: llaves, tipos de
        documento, idempotencia, contingencia, errores y la lista para salir a producción.
      </p>
      <div className="skill-actions">
        <a className="pg-primary" href={SKILL_ZIP_URL} download>Descargar la skill (.zip)</a>
        <a className="pg-secondary" href={SKILL_GITHUB_URL} target="_blank" rel="noopener">Verla en GitHub</a>
      </div>
      <ol className="skill-steps">
        <li>1. Descomprímala en la carpeta de skills de Claude Code:<code className="skill-chip mono">{INSTALL_UNZIP}</code></li>
        <li>2. {INSTALL_ASK}</li>
      </ol>
    </section>
  );
}
