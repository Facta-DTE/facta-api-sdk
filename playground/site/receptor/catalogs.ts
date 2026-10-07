// The official catalogs the custom receiver form searches (see site/catalogs/README.md), loaded lazily:
// the four JSON files are separate chunks that only download when «Personalizado» is opened, so the
// main bundle does not grow.
//
// Search is a port of `searchActivities` from the Facta DTE application (apps/web/src/screens/onboarding/
// catalogs.ts), extended to several words and to a matched-range report so the list can underline what matched.

export interface CatalogEntry { code: string; value: string }
export interface MunicipalityEntry extends CatalogEntry { departamento: string }

export interface Catalogs {
  activities: readonly CatalogEntry[];
  departments: readonly CatalogEntry[];
  municipalities: readonly MunicipalityEntry[];
  countries: readonly CatalogEntry[];
}

let pending: Promise<Catalogs> | null = null;
let ready: Catalogs | null = null;

/** Downloads the four catalogs once. Rejects (and may be retried) when a chunk fails to load. */
export function loadCatalogs(): Promise<Catalogs> {
  if (ready !== null) return Promise.resolve(ready);
  pending ??= Promise.all([
    import("../catalogs/cat-019-actividad-economica.json"),
    import("../catalogs/cat-012-departamento.json"),
    import("../catalogs/cat-013-municipio.json"),
    import("../catalogs/cat-020-pais.json"),
  ]).then(([activities, departments, municipalities, countries]) => {
    ready = {
      activities: activities.default as CatalogEntry[],
      departments: departments.default as CatalogEntry[],
      municipalities: municipalities.default as MunicipalityEntry[],
      countries: countries.default as CatalogEntry[],
    };
    return ready;
  }).catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Lower case, accents and punctuation-insensitive form of a text, with each normalized char's origin index. */
export function fold(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const base = text[i]!.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const char of base) {
      folded += char;
      origin.push(i);
    }
  }
  return { folded, origin };
}

const words = (query: string): string[] => fold(query.trim()).folded.split(/\s+/).filter((w) => w !== "");

export interface Hit<T extends CatalogEntry = CatalogEntry> {
  entry: T;
  /** Half-open ranges [from, to) of `entry.value` to underline. */
  ranges: Array<[number, number]>;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else out.push([range[0], range[1]]);
  }
  return out;
}

/**
 * Entries whose code starts with the query, or whose text contains EVERY word of it (accent-insensitive).
 * Code matches come first, then word-start matches, then the rest; catalog order within each group.
 */
export function searchCatalog<T extends CatalogEntry>(entries: readonly T[], query: string, limit = 8): Hit<T>[] {
  const wanted = words(query);
  if (wanted.length === 0) return [];
  const code = fold(query.trim()).folded;
  const ranked: Array<{ rank: number; hit: Hit<T> }> = [];
  for (const entry of entries) {
    if (entry.code.toLowerCase().startsWith(code)) {
      ranked.push({ rank: 0, hit: { entry, ranges: [] } });
      continue;
    }
    const { folded, origin } = fold(entry.value);
    const ranges: Array<[number, number]> = [];
    let atWordStart = true;
    let all = true;
    for (const word of wanted) {
      const at = folded.indexOf(word);
      if (at < 0) { all = false; break; }
      if (at > 0 && !/[^a-z0-9]/.test(folded[at - 1]!)) atWordStart = false;
      ranges.push([origin[at]!, origin[at + word.length - 1]! + 1]);
    }
    if (all) ranked.push({ rank: atWordStart ? 1 : 2, hit: { entry, ranges: mergeRanges(ranges) } });
  }
  return ranked.map((item, index) => ({ item, index })).sort((a, b) => a.item.rank - b.item.rank || a.index - b.index).slice(0, limit).map((x) => x.item.hit);
}

/** Municipalities of a department (CAT-013, post-2024 division). Empty for an unknown department. */
export function municipalitiesOf(all: readonly MunicipalityEntry[], department: string): MunicipalityEntry[] {
  return all.filter((m) => m.departamento === department);
}

const SMALL = new Set(["de", "del", "la", "las", "el", "los", "y"]);

/** «SAN SALVADOR CENTRO» → «San Salvador Centro»; small words stay lower case except the first. */
export function titleCase(text: string): string {
  return text.toLowerCase().split(" ").map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}
