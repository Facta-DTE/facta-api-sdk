import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appearanceToCssVariables, pickAccentInk, resetAppearanceWarnings } from "../src/browser/index.ts";
import { FactaInvoiceInline, FactaProvider, FactaReceipt } from "../src/react/index.ts";
import { makeClient, NO_MOTION, sealed } from "./helpers.tsx";

const css = readFileSync(resolve(process.cwd(), "src/react/styles.css"), "utf8");

describe("derived tokens", () => {
  afterEach(() => {
    resetAppearanceWarnings();
    vi.restoreAllMocks();
  });

  it("picks white ink when it reaches 4.5:1 and the dark ink otherwise", () => {
    expect(pickAccentInk("#007faa")?.ink).toBe("#ffffff");
    expect(pickAccentInk("#f5d90a")?.ink).toBe("#0b1419");
    expect(pickAccentInk("oklch(0.55 0.13 225)")).toBeNull();
    expect(pickAccentInk("#007faa")?.ok).toBe(true);
  });

  it("derives ink and soft accent from the accent, unless set explicitly", () => {
    const vars = appearanceToCssVariables({ accent: "#f5d90a" });
    expect(vars["--facta-accent-ink"]).toBe("#0b1419");
    expect(vars["--facta-accent-soft"]).toContain("color-mix(in srgb, #f5d90a 12%");
    expect(appearanceToCssVariables({ accent: "#f5d90a" }, { dark: true })["--facta-accent-soft"]).toContain("24%");
    const explicit = appearanceToCssVariables({ accent: "#f5d90a", accentInk: "#111111", accentSoft: "#eeeeee" });
    expect(explicit["--facta-accent-ink"]).toBe("#111111");
    expect(explicit["--facta-accent-soft"]).toBe("#eeeeee");
  });

  it("derives surface, border and muted from bg and text; radiusSm from radius", () => {
    const v = appearanceToCssVariables({ background: "#101820", text: "#f0f0f0", radius: "20px" });
    expect(v["--facta-surface"]).toBe("color-mix(in srgb, #101820 95%, #f0f0f0)");
    expect(v["--facta-border"]).toBe("color-mix(in srgb, #101820 86%, #f0f0f0)");
    expect(v["--facta-muted"]).toBe("color-mix(in srgb, #f0f0f0 62%, #101820)");
    expect(v["--facta-radius-sm"]).toBe("13px");
    expect(appearanceToCssVariables({ radius: "2px" })["--facta-radius-sm"]).toBe("2px");
    expect(appearanceToCssVariables({ radius: "4px" })["--facta-radius-sm"]).toBe("3px");
    expect(appearanceToCssVariables({ radius: "20px", radiusSm: "5px" })["--facta-radius-sm"]).toBe("5px");
  });

  it("maps size tokens and the heading font", () => {
    const v = appearanceToCssVariables({ headingFontFamily: "Georgia", buttonHeight: "52px", downloadHeight: "60px", space: "24px", gap: "10px", windowWidth: "520px", drawerWidth: "480px", titleSize: "20px", totalSize: "40px", fontSizeBase: "16px" });
    expect(v["--facta-font-heading"]).toBe("Georgia");
    expect(v["--facta-button-height"]).toBe("52px");
    expect(v["--facta-download-height"]).toBe("60px");
    expect(v["--facta-space"]).toBe("24px");
    expect(v["--facta-gap"]).toBe("10px");
    expect(v["--facta-window-width"]).toBe("520px");
    expect(v["--facta-drawer-width"]).toBe("480px");
    expect(v["--facta-title-size"]).toBe("20px");
    expect(v["--facta-total-size"]).toBe("40px");
    expect(v["--facta-font-size"]).toBe("16px");
  });

  it("warns once in development when no ink reaches 4.5:1", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    appearanceToCssVariables({ accent: "#7c7c7c" });
    appearanceToCssVariables({ accent: "#7c7c7c" });
    appearanceToCssVariables({ accent: "#7d7d7d" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("[facta-ui]");
    appearanceToCssVariables({ accent: "#007faa" });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("customization hooks", () => {
  function renderSealed(props: Record<string, unknown> = {}, provider: Record<string, unknown> = {}) {
    const { client } = makeClient({ issue: [sealed] });
    return render(
      <FactaProvider client={client} appearance={NO_MOTION} {...provider}>
        <FactaInvoiceInline session="tok" run="auto" {...props} />
      </FactaProvider>,
    );
  }

  it("applies the styles prop to its slot, after the stylesheet", async () => {
    renderSealed({ styles: { total: { fontSize: 40 }, downloadButton: { height: 70 } } });
    await screen.findByText("Total emitido");
    const total = document.querySelector<HTMLElement>('[data-facta-slot="total"]')!;
    expect(total.style.fontSize).toBe("40px");
    expect(document.querySelector<HTMLElement>('[data-facta-slot="downloadButton"]')!.style.height).toBe("70px");
  });

  it("provider-level styles and appearance.styles merge, the component wins", async () => {
    renderSealed(
      { styles: { footer: { padding: 30 } } },
      { styles: { footer: { padding: 10, margin: 4 } }, appearance: { motion: "none", styles: { footer: { gap: 1 }, header: { minHeight: 90 } } } },
    );
    await screen.findByText("Total emitido");
    const footer = document.querySelector<HTMLElement>('[data-facta-slot="footer"]')!;
    expect(footer.style.padding).toBe("30px");
    expect(footer.style.margin).toBe("4px");
    expect(footer.style.gap).toBe("1px");
    expect(document.querySelector<HTMLElement>('[data-facta-slot="header"]')!.style.minHeight).toBe("90px");
  });

  it("classNames and data-facta-slot exist on every slot of the sealed screen", async () => {
    renderSealed({ onClose: () => {}, classNames: { downloadButton: "mi-descarga", identifiers: "mis-ids" } });
    await screen.findByText("Total emitido");
    for (const slot of ["card", "header", "title", "body", "footer", "attribution", "statusIcon", "total", "identifiers", "storageRow", "downloadButton", "primaryButton", "chip"]) {
      expect(document.querySelector(`[data-facta-slot="${slot}"]`), slot).not.toBeNull();
    }
    expect(document.querySelector('[data-facta-slot="downloadButton"]')!.className).toContain("mi-descarga");
    expect(document.querySelector('[data-facta-slot="identifiers"]')!.className).toContain("mis-ids");
  });

  it("exposes state, run and variant on the root for host CSS", async () => {
    renderSealed();
    await screen.findByText("Total emitido");
    const root = document.querySelector<HTMLElement>('[data-facta-slot="root"]')!;
    expect(root.getAttribute("data-facta-state")).toBe("sealed");
    expect(root.getAttribute("data-facta-run")).toBe("auto");
    expect(root.getAttribute("data-facta-variant")).toBe("inline");
    expect(document.querySelector('[data-facta-state="sealed"] [data-facta-slot="total"]')).not.toBeNull();
  });

  it("the receipt reports itself as sealed too", () => {
    render(<FactaReceipt result={sealed} appearance={NO_MOTION} />);
    expect(document.querySelector('[data-facta-state="sealed"][data-facta-variant="inline"]')).not.toBeNull();
  });

  it("explicit size variables are set inline and override the density defaults in the stylesheet", async () => {
    renderSealed({}, { appearance: { motion: "none", density: "compact", variables: { buttonHeight: "52px", space: "28px" } } });
    await screen.findByText("Total emitido");
    const root = document.querySelector<HTMLElement>('[data-facta-slot="root"]')!;
    expect(root.getAttribute("data-facta-density")).toBe("compact");
    expect(root.style.getPropertyValue("--facta-button-height")).toBe("52px");
    expect(root.style.getPropertyValue("--facta-space")).toBe("28px");
    // The density only moves the DEFAULTS; the value in use reads the public token first.
    expect(css).toMatch(/--facta-d-button-height: 38px/);
    expect(css).toMatch(/--facta-i-btn-h: var\(--facta-button-height, var\(--facta-d-button-height\)\)/);
    expect(css).toMatch(/--facta-i-space: var\(--facta-space, var\(--facta-d-space\)\)/);
  });
});

describe("stylesheet specificity", () => {
  /** Specificity (classes + attributes + pseudo-classes) of a selector, ignoring :where(). */
  function weight(selector: string): number {
    let s = selector;
    for (let prev = ""; prev !== s;) {
      prev = s;
      s = s.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
    }
    s = s.replace(/::?(?:before|after)/g, "").replace(/:not\(/g, "(");
    return (s.match(/\.[a-zA-Z_-]/g) ?? []).length + (s.match(/\[/g) ?? []).length + (s.match(/:[a-z-]+/g) ?? []).length;
  }

  it("every selector weighs at most one class, so a single host class wins without !important", () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders: string[] = [];
    const ruleRe = /([^{}@][^{}]*)\{/g;
    for (const m of stripped.matchAll(ruleRe)) {
      const text = m[1]!.trim();
      if (!text || /^\d+%|^from|^to$|^(?:0%|100%)/.test(text) || /^[\d%,\s.]+$/.test(text)) continue;
      const parts: string[] = [];
      for (let depth = 0, cur = "", i = 0; i <= text.length; i++) {
        const c = text[i];
        if (c === "(" || c === "[") depth++;
        if (c === ")" || c === "]") depth--;
        if (i === text.length || (c === "," && depth === 0)) {
          parts.push(cur);
          cur = "";
        } else cur += c;
      }
      for (const sel of parts) {
        const t = sel.trim();
        if (t && weight(t) > 1) offenders.push(t);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a host rule with one class has the same weight as ours and the stylesheet never uses !important outside motion-off", () => {
    const important = (css.replace(/\/\*[\s\S]*?\*\//g, "").match(/!important/g) ?? []).length;
    // Only the two «motion: none / reduced-motion» switches use it, on purpose.
    expect(important).toBe(4);
  });
});
