import { describe, expect, it } from "vitest";
import { appearanceCode, applyPreset, DEFAULT_STUDIO, studioProps } from "../site/sections/screens/appearance-code.ts";

describe("appearance studio code", () => {
  it("prints only a theme for the untouched defaults", () => {
    expect(appearanceCode(DEFAULT_STUDIO)).toBe(['<FactaProvider', '  endpoint="/api/facta"', '  appearance={{ theme: "auto" }}', '>', '  {/* your screens */}', '</FactaProvider>'].join("\n"));
    expect(studioProps(DEFAULT_STUDIO)).toMatchObject({ branding: null, classNames: null, messages: null });
  });

  it("prints the point-of-sale preset with its tokens and brand", () => {
    const code = appearanceCode(applyPreset("pos"));
    expect(code).toContain('appearance={{ theme: "dark", density: "compact", variables: { accent: "#1f7a4d", radius: "8px" } }}');
    expect(code).toContain('branding={{ name: "Ferretería San Miguel" }}');
    expect(code).not.toContain("classNames");
  });

  it("prints the white-label preset: logo element, no attribution, heading font, reduced motion", () => {
    const code = appearanceCode(applyPreset("erp"));
    expect(code).toContain('motion: "reduced"');
    expect(code).toContain("headingFontFamily");
    expect(code).toContain('branding={{ name: "Grupo Altamira", logo: <MyLogo />, attribution: false }}');
  });

  it("prints classNames and message overrides, escaping quotes", () => {
    const code = appearanceCode({ ...DEFAULT_STUDIO, classNames: true, issueLabel: 'Cobrar "ya"', testChip: "Demo" });
    expect(code).toContain('classNames={{ primaryButton: "my-primary", card: "my-card", total: "my-total" }}');
    expect(code).toContain('messages={{ review: { issue: "Cobrar \\"ya\\"" }, chipTest: "Demo" }}');
  });

  it("offers the same props to the preview and to the code", () => {
    const state = { ...applyPreset("pos"), classNames: true };
    const props = studioProps(state);
    expect(props.appearance.variables).toEqual({ accent: "#1f7a4d", radius: "8px" });
    expect(props.classNames).toEqual({ primaryButton: "my-primary", card: "my-card", total: "my-total" });
  });
});
