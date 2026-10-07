// What the guides remember per visitor, in the browser only: the last recipe tab and whether each page's
// «Cómo funciona esta pantalla» card was left open. Every access can throw (private windows, blocked site
// data), so everything here is wrapped and the page renders correctly without it.

export const RECIPE_TAB_KEY = "pg.guide.recipe-tab";
const pageKey = (id: string) => `pg.guide.page.${id}`;

export type RecipeTab = "guia" | "probar" | "codigo";
export const RECIPE_TABS: RecipeTab[] = ["guia", "probar", "codigo"];

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(store: Store | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: Store | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // A full or blocked store only costs the memory of the choice.
  }
}

/** The tab to open: the last one this visitor used, «Cómo funciona» on the first visit. */
export function readRecipeTab(store: Store | null = browserStore()): RecipeTab {
  const saved = read(store, RECIPE_TAB_KEY);
  return RECIPE_TABS.find((tab) => tab === saved) ?? "guia";
}

export function writeRecipeTab(tab: RecipeTab, store: Store | null = browserStore()): void {
  write(store, RECIPE_TAB_KEY, tab);
}

/**
 * Whether a page's card starts open: open on the very first visit, then whatever the visitor last chose.
 * The first read marks the page as seen, so the next visit starts collapsed.
 */
export function readPageGuideOpen(id: string, store: Store | null = browserStore()): boolean {
  const saved = read(store, pageKey(id));
  if (saved === "open") return true;
  if (saved === "closed") return false;
  write(store, pageKey(id), "closed");
  return true;
}

export function writePageGuideOpen(id: string, open: boolean, store: Store | null = browserStore()): void {
  write(store, pageKey(id), open ? "open" : "closed");
}
