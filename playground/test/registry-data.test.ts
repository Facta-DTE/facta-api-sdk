import { describe, expect, it } from "vitest";
import type { RegistryDocument } from "../site/api.ts";
import { needsEnrich, resultFromRegistry, totalOf } from "../site/sections/registro/registry-rows.ts";

const row = (patch: Partial<RegistryDocument> = {}): RegistryDocument => ({
  codigoGeneracion: "AAAAAAAA-0000-4000-8000-000000000001", tipoDte: "01", numeroControl: "DTE-01-M001P001-000000000000001",
  issuedAt: "2026-10-06T16:42:00.000Z", estado: "sellado", current: null, ...patch,
});

describe("registry rows", () => {
  it("shows the total stored at issue time, else the API's view, else nothing", () => {
    expect(totalOf(row({ total: 12.5 }))).toBe(12.5);
    expect(totalOf(row({ current: { estado: "sellado", totales: { montoTotalOperacion: 9.99 } } as never }))).toBe(9.99);
    expect(totalOf(row())).toBeNull();
  });

  it("asks the API only for what the ledger cannot answer", () => {
    expect(needsEnrich(row({ total: 12.5 }))).toBe(false); // final state with its total: nothing left to learn
    expect(needsEnrich(row({ total: 12.5, estado: "invalidado" }))).toBe(false);
    expect(needsEnrich(row())).toBe(true); // an older row without a total
    expect(needsEnrich(row({ total: 4, estado: "contingencia" }))).toBe(true); // pending: the state may have changed
    expect(needsEnrich(row({ total: 4, estado: "contingencia", current: { estado: "contingencia" } as never }))).toBe(false);
  });

  it("builds the SDK's own result from a row of an earlier visit, for the receipt, badge and download button", () => {
    const sealed = resultFromRegistry(row({ total: 12.5, current: { estado: "sellado", fecEmi: "2026-10-06", horEmi: "10:42:00", selloRecibido: "SELLO", observaciones: [] } as never }));
    expect(sealed).toMatchObject({ estado: "sellado", codigoGeneracion: "AAAAAAAA-0000-4000-8000-000000000001", selloRecibido: "SELLO", fecEmi: "2026-10-06", horEmi: "10:42:00", totales: { totalPagar: 12.5 } });
    // Even with nothing but the ledger, there is a document to show (no seal, no invented values).
    const bare = resultFromRegistry(row({ total: 3 }));
    expect(bare).toMatchObject({ estado: "sellado", fecEmi: "2026-10-06", totales: { totalPagar: 3 } });
    expect(bare.selloRecibido).toBeUndefined();
    expect(resultFromRegistry(row({ estado: "contingencia" })).estado).toBe("contingencia");
  });
});
