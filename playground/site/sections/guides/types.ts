// The shape of every in-place guide of the playground. Pure data: no React, no CSS, so a test can read it
// in Node and check each claim against the SDK (test/guides.test.ts).
//
// Inline markup in any text field: `**bold**` and `` `code` ``. Nothing else, and never HTML.

export interface GuideLink {
  label: string;
  /** An external address (GitHub, the contract). */
  href?: string;
  /** A playground route, with its query (for example `/servidor?receta=status-recovery`). */
  to?: string;
}

export interface GuideStep {
  title: string;
  text: string;
  /** SDK calls, written as the reader would type them: `facta.issue(venta, { idempotencyKey })`. */
  sdk?: string[];
  /** HTTP routes behind those calls: `POST /v1/dte`. */
  http?: string[];
}

export interface GuideError {
  /** A real `FactaErrorCode` from src/errors.ts. */
  code: string;
  text: string;
}

export interface GuideConcept {
  title: string;
  text: string;
}

/** What a server recipe page explains under «Cómo funciona». */
export interface RecipeGuide {
  problem: string;
  steps: GuideStep[];
  look: string[];
  use: string[];
  /** The red box. */
  dont: string;
  /** The green box. */
  rule: string;
  /** Ideas a newcomer needs before the steps make sense. */
  concepts?: GuideConcept[];
  errors: GuideError[];
  /** Said instead of the errors card when the recipe never throws. */
  noErrors?: string;
  more: GuideLink[];
}

/** The lighter card at the top of the other pages: «Cómo funciona esta pantalla». */
export interface PageGuide {
  problem: string;
  what: string;
  look: string[];
  /** SDK pieces the page uses, for the test to check (`facta.x` calls, component names). */
  sdk?: string[];
  more: GuideLink[];
}
