// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { INSTALL_UNZIP, SkillCard } from "../site/components/skill-card.tsx";
import { Referencia } from "../site/sections/referencia/index.tsx";
import { SKILL_GITHUB_URL, SKILL_ZIP_URL } from "../site/source-links.ts";

afterEach(cleanup);

describe("«Skill para su agente de IA» card", () => {
  it("offers the zip and the GitHub folder, with the two-line install", () => {
    render(<SkillCard />);
    const zip = screen.getByRole("link", { name: "Descargar la skill (.zip)" });
    expect(zip.getAttribute("href")).toBe(SKILL_ZIP_URL);
    expect(zip.hasAttribute("download")).toBe(true);
    const github = screen.getByRole("link", { name: "Verla en GitHub" });
    expect(github.getAttribute("href")).toBe(SKILL_GITHUB_URL);
    expect(github.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(INSTALL_UNZIP)).toBeTruthy();
    expect(document.body.textContent).toContain("integra Facta DTE en este proyecto");
  });

  it("is the first thing under the title of Referencia", () => {
    render(<Referencia />);
    const card = document.querySelector("[data-testid=skill-card]");
    expect(card).not.toBeNull();
    expect(card?.closest("header")?.querySelector("h1")).not.toBeNull();
  });
});
