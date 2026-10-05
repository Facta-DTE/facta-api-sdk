# Shared brief for the React UI design boards (5-Oct-2026)

Read `docs/react-signing-ui.md` §7, §10 and §11 first. §10 supersedes parts of
§3–§7: NO recipient form, NO Factura/Crédito fiscal switch, NO «Corregir
datos», NO review-prepared mode. Data arrives correct from the host system;
errors are read-only.

## What the boards are
Self-contained HTML design boards (no build step) that show each component
exactly as it should look, at real size, in light and dark, desktop
(1280-wide frame) and phone (390×844 frame). They are the reference the
implementation will copy, so be precise: spacing, type sizes, states.

## Hard rules for every board file
- Full HTML document: `<!doctype html>`, `<meta charset="utf-8">`,
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
  `<title>`, inline `<style>` and `<script>`. No external resources except
  Google Fonts stylesheets (fonts.googleapis.com). No images by URL; use
  inline SVG. No `alert/confirm/prompt`, no downloads, no iframes.
- Page must not scroll horizontally at 390px; wide frames go inside
  `overflow-x:auto` containers. 16px side gutter.
- Board chrome (titles, captions, annotations) uses "IBM Plex Sans" /
  "IBM Plex Mono" and the board tokens below; the COMPONENTS themselves use
  `font-family: var(--facta-font)` defaulting to
  `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (they inherit the
  host's font in real life).
- Board theme: define tokens on `:root` (light), redefine under
  `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){…}}`
  and `:root[data-theme="dark"]{…}`; `body{background:var(--board-bg)}`.
- Component theme is INDEPENDENT of the board theme: each component frame sets
  `data-facta-theme="light"` or `"dark"` explicitly and shows both side by side.
- Spanish (El Salvador) product copy, always «usted». Fictional data only:
  «Café Las Brumas, S.A. de C.V.», «Ferretería San Miguel», buyer «María
  José Hernández». Money `$1,234.56`, tabular numbers. Control numbers like
  `DTE-01-M001P001-000000000000042`, generation codes like UUID upper-case.
- Annotate: small mono captions naming the component, the prop/variant and
  the state, plus redlines for key sizes where useful (radius, paddings,
  44px targets, widths).
- Motion: demonstrate with real CSS keyframes/WAAPI on a «▶ Reproducir»
  button per animated element (replayable), each with a spec caption
  (duration, easing, property). Respect prefers-reduced-motion.

## Component tokens (use exactly these names and defaults)
Light:
--facta-accent: oklch(0.55 0.13 225) /* Torogoz, sRGB fallback #007faa */
--facta-accent-ink: #ffffff
--facta-accent-soft: oklch(0.95 0.03 225)
--facta-bg: #ffffff            (window surface)
--facta-surface: #f6f9fb       (inner blocks)
--facta-text: #13212a
--facta-muted: #5d6f7a
--facta-border: #dce5eb
--facta-success: #1f8a5b  --facta-success-soft: #e5f4ec
--facta-warning: #a86a00  --facta-warning-soft: #fdf2dd
--facta-danger:  #b4372f  --facta-danger-soft:  #fbe7e5
--facta-radius: 14px  --facta-radius-sm: 9px
--facta-shadow: 0 1px 2px rgb(16 24 32 / .06), 0 12px 40px rgb(16 24 32 / .14)
--facta-overlay: rgb(10 18 24 / .45)
Dark:
--facta-accent: oklch(0.7 0.12 225); --facta-accent-ink: oklch(0.16 0.02 230)
--facta-accent-soft: oklch(0.3 0.05 230); --facta-bg: #121c22;
--facta-surface: #18252d; --facta-text: #e6eef2; --facta-muted: #94a7b2;
--facta-border: #26353e; --facta-success: #5cc496; --facta-success-soft:#173327;
--facta-warning:#e3a744; --facta-warning-soft:#3a2c12; --facta-danger:#ef7d74;
--facta-danger-soft:#3d1d1a; --facta-overlay: rgb(0 0 0 / .6)
Density: comfortable (default; body padding 20px, row gap 12px, button height
44px) and compact (16px, 8px, 38px desktop / still 44px touch on phone).

## Visual direction
Calm fintech, trustworthy, quiet. Clear hierarchy: one primary action per
screen. The total is the hero number. Identifiers in mono, small, copyable.
Status by colour AND icon AND words. No gradients, no emoji, no heavy
borders on every block; use surface tint to group. Branding footer
«Emitido con Facta DTE» with a tiny seal glyph, 12px muted — and every board
must also show the white-label version (host logo/name in header, no footer).
