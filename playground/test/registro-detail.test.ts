import { describe, expect, it } from "vitest";
import { findDetails } from "../server/registro-detail.ts";
import type { DtePage } from "../../src/types.ts";

const own = "AAAAAAAA-0000-4000-8000-000000000001";
const other = "BBBBBBBB-0000-4000-8000-000000000002";
const row = (code: string, extra: Record<string, unknown> = {}) => ({ estado: "sellado", codigoGeneracion: code.toLowerCase(), numeroControl: "N", tipoDte: "01", fecEmi: "2026-10-06", ...extra });
const resumen = { receptor: { nombre: "Ana", tipoDocumento: "13", numDocumento: "053085465" }, lineas: 1, primeraDescripcion: "Café", totalIva: 1, totalPagar: 3 };

describe("registro detail", () => {
  it("keeps only the visitor's own rows and never returns another visitor's receiver", async () => {
    const page = { documentos: [row(other, { archivoDte: "{}", resumen: { ...resumen, receptor: { nombre: "Ajeno", tipoDocumento: "13", numDocumento: "1" } } }), row(own, { archivoDte: "{}", resumen })], siguiente: null } as unknown as DtePage;
    const result = await findDetails(async () => page, new Map([[own, "2026-10-06T10:00:00Z"]]));
    expect(result.supported).toBe(true);
    expect(result.documents.map((d) => d.codigoGeneracion)).toEqual([own]);
    expect(JSON.stringify(result)).not.toContain("Ajeno");
  });

  it("walks pages with the cursor until the own rows are found, and asks include=dte with the oldest day", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const pages = [
      { documentos: [row(other, { archivoDte: "{}" })], siguiente: "c1" },
      { documentos: [row(own, { dteError: { code: "needs_local_decrypt", message: "x" } })], siguiente: "c2" },
    ] as unknown as DtePage[];
    const result = await findDetails(async (filters) => { asked.push(filters as Record<string, unknown>); return pages[asked.length - 1]!; }, new Map([[own, "2026-10-06T10:00:00Z"]]));
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatchObject({ include: ["dte"], limit: 25, desde: "2026-10-05" });
    expect(asked[1]).toMatchObject({ cursor: "c1" });
    expect(result.documents[0]?.dteError?.code).toBe("needs_local_decrypt");
  });

  it("reports supported:false when the API ignored the flag", async () => {
    const page = { documentos: [row(own)], siguiente: null } as unknown as DtePage;
    const result = await findDetails(async () => page, new Map([[own, "2026-10-06T10:00:00Z"]]));
    expect(result).toEqual({ supported: false, documents: [] });
  });

  it("stops at the page bound", async () => {
    let calls = 0;
    await findDetails(async () => { calls += 1; return { documentos: [row(other, { archivoDte: "{}" })], siguiente: "more" } as unknown as DtePage; }, new Map([[own, "2026-10-06T10:00:00Z"]]), 3);
    expect(calls).toBe(3);
  });
});
