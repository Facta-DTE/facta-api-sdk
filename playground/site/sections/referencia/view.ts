// The page's pure helpers: counts, status chips, readable names and guide links. No React, so tests can use them.
import { GUIDES, RAW_FILE_BASE, type CoverageEntry, type Demo } from "../../../shared/sdk-coverage.ts";

export type Tone = "live" | "simulated" | "documented";

export function statusOf(demo: Demo): { tone: Tone; label: string } {
  switch (demo.kind) {
    case "recipe": return { tone: "live", label: "Receta en staging" };
    case "page": return { tone: "live", label: "En vivo en el playground" };
    case "simulated": return { tone: "simulated", label: "Simulada" };
    case "documented": return { tone: "documented", label: "Solo documentado" };
  }
}

export function demoCounts(entries: readonly CoverageEntry[]): { live: number; simulated: number; documented: number } {
  const counts = { live: 0, simulated: 0, documented: 0 };
  for (const entry of entries) counts[statusOf(entry.demo).tone]++;
  return counts;
}

/** What an entry covers, as a person reads it: `mod:DteRequest` → `DteRequest`, `Facta#issue` → `facta.issue`, `FactaOptions.region` and `error:x` stay. */
export function displayNames(entry: CoverageEntry): string[] {
  const seen = new Set<string>();
  for (const pattern of entry.covers) {
    const name = pattern.replace(/^(?:mod|server|browser|react|node|file-archive|\*):/, "");
    // «Facta#issue» reads as the call it is: facta.issue. The wildcard families read as they are written.
    seen.add(name.startsWith("Facta#") ? `facta.${name.slice("Facta#".length)}` : name);
  }
  return [...seen];
}

export interface GuideLink { stem: string; title: string; href: string }

/** Guides open the Spanish file when it exists, English otherwise. */
export function guideLinks(entry: CoverageEntry): { guides: GuideLink[]; portal: string[]; sources: string[] } {
  return {
    guides: entry.guides.map((stem) => {
      const guide = GUIDES[stem]!;
      return { stem, title: guide.title, href: `${RAW_FILE_BASE}guides/${stem}${guide.es ? ".es" : ""}.md` };
    }),
    portal: entry.portal ?? [],
    sources: entry.sources.filter((path) => path.startsWith("src/") || path.startsWith("docs/")),
  };
}
