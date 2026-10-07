// The order numbers this visitor has used in this browser session, per surface (the sale builder, each recipe).
//
// An order number is the idempotency key's identity: the same one sent twice is the same invoice. The page
// remembers which numbers were already issued so it can say, BEFORE sending, that a request will be a repeat,
// and compare the repeat with the first answer afterwards. This is a convenience of the page, not a source of
// truth: the API decides what a repeat is. Kept in sessionStorage (every access wrapped: it can be blocked).

import { useSyncExternalStore } from "react";

export interface UsedOrder {
  scope: string;
  order: string;
  /** DTE type of the first request («01»). */
  type: string;
  total: number | null;
  code: string | null;
  control: string | null;
  /** How long the first request took, ms. */
  ms: number | null;
  /** How many times the same order came back with the same document. */
  repeats: number;
}

/** A repeat that has just been answered, with what the first request said. */
export interface RepeatOutcome {
  scope: string;
  order: string;
  first: { code: string | null; control: string | null; ms: number | null };
  again: { code: string | null; control: string | null; ms: number | null };
}

const KEY = "facta-playground-orders";
const LIMIT = 30;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function createOrderStore(storage: () => StorageLike | null = () => (typeof sessionStorage === "undefined" ? null : sessionStorage)) {
  const listeners = new Set<() => void>();
  let used: UsedOrder[] = [];
  let pending: { scope: string; order: string; type: string; total: number | null } | null = null;
  let repeat: RepeatOutcome | null = null;
  let snapshot = 0;

  try {
    const raw = storage()?.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) used = (parsed as UsedOrder[]).filter((u) => typeof u?.order === "string" && typeof u.scope === "string").slice(0, LIMIT);
    }
  } catch { /* storage blocked or corrupt: start empty */ }

  const emit = () => {
    snapshot += 1;
    try { storage()?.setItem(KEY, JSON.stringify(used)); } catch { /* ignore */ }
    listeners.forEach((l) => l());
  };

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => void listeners.delete(listener); },
    version: () => snapshot,
    list: (scope: string): UsedOrder[] => used.filter((u) => u.scope === scope),
    /** The entry a request for this order (and type, when the surface keys by type) would repeat. */
    find(scope: string, order: string, type?: string): UsedOrder | null {
      return used.find((u) => u.scope === scope && u.order === order.trim() && (type === undefined || u.type === type)) ?? null;
    },
    /** A fresh readable number that this surface has not used. */
    fresh(scope: string, make: () => string): string {
      for (let i = 0; i < 50; i++) {
        const candidate = make();
        if (!used.some((u) => u.scope === scope && u.order === candidate)) return candidate;
      }
      return make();
    },
    /** A sale was prepared for this order: the next issued document belongs to it. */
    pend(scope: string, order: string, type: string, total: number | null) {
      pending = { scope, order: order.trim(), type, total };
      repeat = null;
      emit();
    },
    /** A document was issued (or answered again) for the pending order. */
    issued(result: { code: string | null; control: string | null; ms: number | null; replay: boolean }) {
      if (pending === null) return;
      const { scope, order, type, total } = pending;
      pending = null;
      this.record({ scope, order, type, total, ...result });
    },
    /** Records an issued document under (scope, order); a second answer with the same code is a repeat. */
    record(entry: { scope: string; order: string; type: string; total: number | null; code: string | null; control: string | null; ms: number | null; replay?: boolean }) {
      const known = used.find((u) => u.scope === entry.scope && u.order === entry.order);
      const sameDocument = known !== undefined && (entry.replay === true || (known.code !== null && known.code === entry.code));
      if (known !== undefined && sameDocument) {
        known.repeats += 1;
        repeat = { scope: entry.scope, order: entry.order, first: { code: known.code, control: known.control, ms: known.ms }, again: { code: entry.code, control: entry.control, ms: entry.ms } };
      } else if (known === undefined && entry.replay === true) {
        // The API remembered an order this page session never saw: the first answer is unknown.
        used.unshift({ scope: entry.scope, order: entry.order, type: entry.type, total: entry.total, code: entry.code, control: entry.control, ms: null, repeats: 1 });
        repeat = { scope: entry.scope, order: entry.order, first: { code: null, control: null, ms: null }, again: { code: entry.code, control: entry.control, ms: entry.ms } };
      } else {
        used = used.filter((u) => !(u.scope === entry.scope && u.order === entry.order));
        used.unshift({ scope: entry.scope, order: entry.order, type: entry.type, total: entry.total, code: entry.code, control: entry.control, ms: entry.ms, repeats: 0 });
        repeat = null;
      }
      used = used.slice(0, LIMIT);
      emit();
    },
    lastRepeat: (): RepeatOutcome | null => repeat,
    clearRepeat() { repeat = null; emit(); },
    /** How many times a document came back as a repeat in this session. */
    repeatsOf: (code: string): number => used.filter((u) => u.code === code).reduce((n, u) => n + u.repeats, 0),
  };
}

export const orders = createOrderStore();

/** Re-renders when the session list changes. */
export function useOrders(): typeof orders {
  useSyncExternalStore(orders.subscribe, orders.version, orders.version);
  return orders;
}

/** The sale panels share one scope: the same order number is the same key in Pantallas React and Mi propia implementación. */
export const SALE_SCOPE = "sale";
export const recipeScope = (id: string) => `recipe:${id}`;

const TYPE_SHORT: Record<string, string> = { "01": "FE", "03": "CCF", "05": "NC", "06": "ND", "11": "FEX", "14": "FSE" };
export const typeShort = (type: string): string => TYPE_SHORT[type] ?? type;
const TYPE_NAME: Record<string, string> = { "01": "Factura", "03": "Crédito fiscal", "05": "Nota de crédito", "06": "Nota de débito", "11": "Exportación", "14": "Sujeto excluido" };
export const typeName = (type: string): string => TYPE_NAME[type] ?? `Tipo ${type}`;
