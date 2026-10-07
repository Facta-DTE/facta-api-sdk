# Skill `facta-dte-api` / Agent skill for Facta DTE integrations

[English](#english) · [Español](#español)

## English

`facta-dte-api` is an **agent skill** (the `SKILL.md` + `references/` format used by Claude Code
and other agents that read it) that helps a developer, and their AI coding agent, integrate
**Facta DTE** electronic invoicing for El Salvador with the `@facta-dte/api` SDK or the HTTP API:
setup and keys, every DTE type, idempotency, contingency, invalidation, returns, files and delivery,
catalog, storage, errors, debugging and a production checklist. Every statement is grounded in this
repository's code and guides and in the published OpenAPI contract; where the sources are silent, the
skill says so instead of guessing.

What is inside:

```
skills/facta-dte-api/
  SKILL.md            when to use it, the non-negotiable rules, a router to the references
  references/         loaded on demand: setup, DTE types, idempotency, contingency/invalidation/return,
                      files and delivery, catalog, storage, browser and React, errors, debugging,
                      production checklist, common mistakes, recipes (links to the playground's real code)
  templates/          type-checked starters: Express, Next.js, React checkout, order webhook → invoice
```

### Install in Claude Code

1. Get the zip (below), or copy the folder `skills/facta-dte-api/` from this repository.
2. Put the folder `facta-dte-api` where Claude Code loads skills:
   - for all your projects: `~/.claude/skills/facta-dte-api/`
   - for one project (commit it so the team shares it): `<project>/.claude/skills/facta-dte-api/`

   ```sh
   unzip facta-dte-api-skill.zip -d ~/.claude/skills/        # personal
   unzip facta-dte-api-skill.zip -d .claude/skills/          # one project
   ```
3. Start a new session. Ask for what you need («integrate Facta DTE invoicing in this Express app»);
   Claude loads the skill from its `description`, or invoke it by name.

### Other agents

Any agent that reads the Agent Skills layout can load the same folder from its own skills directory.
For an agent that does not support skills, give it `skills/facta-dte-api/SKILL.md` as context and let it
open the files under `references/` when `SKILL.md` points to them.

### Download

- **Latest:** https://github.com/Facta-DTE/facta-api-sdk/releases/download/skill-latest/facta-dte-api-skill.zip (refreshed on every change to `skills/` on `main`).
- **Per version:** each npm release has a GitHub Release (`vX.Y.Z`) with `facta-dte-api-skill.zip` and the npm tarball attached: https://github.com/Facta-DTE/facta-api-sdk/releases
- Build it: `pnpm skill:pack` writes `dist/facta-dte-api-skill.zip` (deterministic: the same files
  always give the same bytes).
- Every CI run of this repository attaches it as the `facta-dte-api-skill` artifact.
- The playground offers the same zip («Skill para su agente de IA») once its release ships.

The skill **ships inside the npm package** (`@facta-dte/api` 0.5.0 and later): after `npm install`, copy `node_modules/@facta-dte/api/skills/facta-dte-api/` to `~/.claude/skills/` (or your project's `.claude/skills/`). Check it with `pnpm skill:check` (templates type-check
against the SDK, links resolve, `references/errors.md` matches `FactaErrorCode`).

## Español

`facta-dte-api` es una **skill para agentes de IA** (el formato `SKILL.md` + `references/` que usa
Claude Code y otros agentes) que ayuda a una persona desarrolladora, y a su agente de código, a integrar
la facturación electrónica de **Facta DTE** (El Salvador) con el SDK `@facta-dte/api` o con la API HTTP:
configuración y llaves, cada tipo de DTE, idempotencia, contingencia, anulación, devoluciones, archivos y
entrega, catálogo, almacenamiento, errores, depuración y una lista para salir a producción. Todo lo que
afirma sale del código y las guías de este repositorio y del contrato OpenAPI publicado; si las fuentes
no dicen algo, la skill lo dice en lugar de inventarlo. El contenido técnico está en inglés; el texto que
su aplicación muestre a sus clientes debe ir en español de El Salvador, tratando de usted.

### Instalar en Claude Code

1. Descargue el zip (abajo) o copie la carpeta `skills/facta-dte-api/` de este repositorio.
2. Deje la carpeta `facta-dte-api` donde Claude Code busca skills:
   - para todos sus proyectos: `~/.claude/skills/facta-dte-api/`
   - para un solo proyecto (súbala al repositorio para que la use el equipo): `<proyecto>/.claude/skills/facta-dte-api/`

   ```sh
   unzip facta-dte-api-skill.zip -d ~/.claude/skills/        # personal
   unzip facta-dte-api-skill.zip -d .claude/skills/          # un proyecto
   ```
3. Abra una sesión nueva y pida lo que necesita («integra la facturación de Facta DTE en esta app de
   Express»). Claude carga la skill a partir de su descripción, o puede invocarla por nombre.

### Otros agentes

Cualquier agente que lea el formato Agent Skills puede cargar la misma carpeta desde su directorio de
skills. Si el suyo no admite skills, dele `skills/facta-dte-api/SKILL.md` como contexto y que abra los
archivos de `references/` cuando `SKILL.md` se los indique.

### Descarga

- **La más reciente:** https://github.com/Facta-DTE/facta-api-sdk/releases/download/skill-latest/facta-dte-api-skill.zip (se actualiza con cada cambio de `skills/` en `main`).
- **Por versión:** cada versión de npm tiene su GitHub Release (`vX.Y.Z`) con `facta-dte-api-skill.zip` y el tarball de npm adjuntos: https://github.com/Facta-DTE/facta-api-sdk/releases
- Constrúyala: `pnpm skill:pack` escribe `dist/facta-dte-api-skill.zip` (determinista: los mismos
  archivos dan siempre los mismos bytes).
- Cada ejecución de CI de este repositorio la adjunta como artefacto `facta-dte-api-skill`.
- El playground ofrece el mismo zip («Skill para su agente de IA») cuando salga su versión.

La skill **viaja dentro del paquete de npm** (`@facta-dte/api` 0.5.0 en adelante): después de `npm install`, copie `node_modules/@facta-dte/api/skills/facta-dte-api/` a `~/.claude/skills/` (o al `.claude/skills/` de su proyecto). Se verifica con `pnpm skill:check` (las plantillas compilan
contra el SDK, los enlaces existen y `references/errors.md` coincide con `FactaErrorCode`).
