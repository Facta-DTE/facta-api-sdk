import { describe, expect, it } from "vitest";
import activities from "../site/catalogs/cat-019-actividad-economica.json";
import departments from "../site/catalogs/cat-012-departamento.json";
import municipalities from "../site/catalogs/cat-013-municipio.json";
import countries from "../site/catalogs/cat-020-pais.json";
import { fold, municipalitiesOf, searchCatalog, titleCase, type MunicipalityEntry } from "../site/receptor/catalogs.ts";
import { checkDocument, checkNrc, duiCheckDigit, makeDui, makeNit, nitCheckDigit } from "../site/receptor/identity.ts";
import { DOCS, docTypeOf, isEmptyForm, missingText, previewLines, receptorChecklist, typedReceptor } from "../site/receptor/model.ts";
import { presetsFor } from "../site/receptor/presets.ts";
import { buildCustomReceptor } from "../server/receptor.ts";
import { receptorForSale, receptorMissing, EMPTY_CHOICE } from "../site/sections/screens/sale-receptor.tsx";

describe("DUI and NIT check digits (ported from the application)", () => {
  it("accepts numbers whose last digit is the computed one", () => {
    expect(duiCheckDigit("00016297-5")).toBe(5); // the forum's worked example
    expect(checkDocument("13", "00016297-5").valid).toBe(true);
    expect(checkDocument("36", "0614-170892-101-1").valid).toBe(true);
    expect(checkDocument("36", "06141708921011").wire).toBe("06141708921011");
    expect(nitCheckDigit("06141708921011")).toBe(1);
  });
  it("rejects a wrong check digit and says the expected one", () => {
    const dui = checkDocument("13", "00016297-4");
    expect(dui.valid).toBe(false);
    expect(dui.problem).toContain("debería ser 5");
    expect(checkDocument("36", "0614-170892-101-4").problem).toContain("debería ser 1");
  });
  it("rejects wrong lengths and letters in a DUI or NIT", () => {
    expect(checkDocument("13", "1234").problem).toContain("9 dígitos");
    expect(checkDocument("36", "1234567890").problem).toContain("14 dígitos");
    expect(checkDocument("13", "0001629A5").valid).toBe(false);
    expect(checkDocument("13", "").problem).toBeNull();
  });
  it("accepts a nine-digit NIT only when it is a valid DUI (homologated)", () => {
    expect(checkDocument("36", "00016297-5")).toMatchObject({ valid: true, wire: "000162975" });
    expect(checkDocument("36", "000162974").valid).toBe(false);
  });
  it("strips dashes on the wire and tells how it travels", () => {
    expect(checkDocument("36", "0614-170892-101-1").note).toBe("14 dígitos. Se envía sin guiones: 06141708921011");
    expect(checkDocument("13", "01234567-8").wire).toBe("012345678");
  });
  it("another document is free text of 3 to 20 characters", () => {
    expect(checkDocument("37", "AB-1234").valid).toBe(true);
    expect(checkDocument("37", "x").valid).toBe(false);
  });
  it("NRC: dash removed, 2–8 digits, never zeros", () => {
    expect(checkNrc("123456-7")).toMatchObject({ valid: true, wire: "1234567" });
    expect(checkNrc("1").valid).toBe(false);
    expect(checkNrc("00000").valid).toBe(false);
    expect(checkNrc("123456789").valid).toBe(false);
  });
});

describe("activity search over CAT-019", () => {
  it("has the 774 official activities", () => expect(activities).toHaveLength(774));
  it("finds by code prefix first", () => {
    const hits = searchCatalog(activities, "1071");
    expect(hits[0]!.entry.code.startsWith("1071")).toBe(true);
  });
  it("finds by accent-insensitive words and underlines what matched", () => {
    const hits = searchCatalog(activities, "panaderia");
    expect(hits.length).toBeGreaterThan(0);
    const hit = hits[0]!;
    const [from, to] = hit.ranges[0]!;
    expect(hit.entry.value.slice(from, to).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")).toBe("panaderia");
  });
  it("needs every word, in any order", () => {
    const hits = searchCatalog(activities, "galletas pan");
    expect(hits.some((h) => h.entry.code === "10712")).toBe(true);
    expect(searchCatalog(activities, "pan zzzzqq")).toEqual([]);
  });
  it("returns at most eight results and nothing for an empty query", () => {
    expect(searchCatalog(activities, "venta")).toHaveLength(8);
    expect(searchCatalog(activities, "   ")).toEqual([]);
  });
  it("ranks a whole word, then a word start, then a match inside a word", () => {
    const all = searchCatalog(activities, "pan", 774).map((h) => fold(h.entry.value).folded);
    const tier = (v: string) => (/(^|[^a-zñ])pan([^a-zñ]|$)/.test(v) ? 1 : /(^|[^a-zñ])pan/.test(v) ? 2 : 3);
    expect(all.map(tier)).toEqual([...all.map(tier)].sort((a, b) => a - b));
    expect(tier(all[0]!)).toBe(1);
  });
  it("a code prefix beats any description", () => {
    expect(searchCatalog(activities, "47")[0]!.entry.code.startsWith("47")).toBe(true);
  });
  it("does not fold ñ into n: «pan» does not find «pañales»", () => {
    expect(fold("Pañales").folded).toBe("pañales");
    expect(fold("Panadería").folded).toBe("panaderia");
    const only = activities.filter((a) => /pañal/i.test(a.value) && !/(^|[^a-zñ])pan/i.test(a.value.replace(/pañal\w*/gi, "")));
    for (const entry of only) expect(searchCatalog([entry], "pan")).toEqual([]);
    expect(searchCatalog(activities, "pañal").length).toBeGreaterThan(0);
  });
  it("countries: by name without accents and by code", () => {
    expect(searchCatalog(countries, "mexico")[0]!.entry.code).toBe("MX");
    expect(searchCatalog(countries, "GT")[0]!.entry.value).toBe("Guatemala");
  });
});

describe("department and municipality (CAT-012, CAT-013 post-2024)", () => {
  it("lists only the municipalities of a department, with the 2024 division", () => {
    const sansalvador = municipalitiesOf(municipalities as MunicipalityEntry[], "06");
    expect(sansalvador.map((m) => m.code)).toEqual(["20", "21", "22", "23", "24"]);
    expect(titleCase(sansalvador[3]!.value)).toBe("San Salvador Centro");
    expect(municipalitiesOf(municipalities as MunicipalityEntry[], "99")).toEqual([]);
    expect(departments.find((d) => d.code === "06")?.value).toBe("San Salvador");
  });
});

describe("presets are fictitious and format-valid", () => {
  const types = ["01", "03", "05", "06", "11", "14"];
  const named = types.flatMap((type) => presetsFor(type).map((preset) => [type, preset] as const));

  it("every type offers examples", () => {
    for (const type of types) expect(presetsFor(type).length).toBeGreaterThan(0);
  });
  it.each(named)("%s · %s satisfies the checklist, the server rules and the catalogs", (type, preset) => {
    const f = preset.fields;
    expect(receptorChecklist(type, f).missing).toBe(0);
    // The server (the authority) accepts exactly what the form sends.
    const sent = typedReceptor(type, f);
    if (!(type === "01" && isEmptyForm(type, f))) expect(() => buildCustomReceptor(type, sent)).not.toThrow();
    // Format-valid and fictitious.
    if (f.numDocumento !== undefined && type !== "11") expect(checkDocument(docTypeOf(type, f), f.numDocumento).valid).toBe(true);
    if (f.correo !== undefined) expect(f.correo).toMatch(/\.example$/);
    if (f.nombre !== undefined) expect(f.nombre).toMatch(/Ejemplo|Example/);
    // Catalog references are real entries.
    if (f.codActividad !== undefined) expect(activities.find((a) => a.code === f.codActividad)?.value).toBe(f.descActividad);
    if (f.departamento !== undefined) expect(municipalities.some((m) => m.departamento === f.departamento && m.code === f.municipio)).toBe(true);
    if (f.codPais !== undefined) expect(countries.find((c) => c.code === f.codPais)?.value).toBe(f.nombrePais);
  });
  it("makeDui and makeNit build valid numbers", () => {
    expect(checkDocument("13", makeDui("02468135")).valid).toBe(true);
    expect(checkDocument("36", makeNit("0614210389102")).valid).toBe(true);
  });
});

describe("typedReceptor: the JSON the page sends", () => {
  it("CCF empresa: dashes out, address grouped, document type with its number", () => {
    const sent = typedReceptor("03", presetsFor("03")[0]!.fields);
    expect(sent).toMatchObject({ tipoDocumento: "36", numDocumento: "06141708921011", nrc: "1234567", codActividad: "10712", telefono: "22220000", direccion: { departamento: "06", municipio: "23" } });
    expect(JSON.stringify(sent)).not.toContain("-");
  });
  it("sends the default document type the form showed when the visitor never chose one", () => {
    expect(typedReceptor("03", { numDocumento: "0614-170892-101-1" })).toEqual({ tipoDocumento: "36", numDocumento: "06141708921011" });
    expect(typedReceptor("14", { numDocumento: "01234567-8" })).toEqual({ tipoDocumento: "13", numDocumento: "012345678" });
    expect(typedReceptor("01", { nombre: "Ana" })).toEqual({ nombre: "Ana" });
  });
  it("FEX: no address group, country upper-cased, person type numeric", () => {
    const sent = typedReceptor("11", presetsFor("11")[0]!.fields);
    expect(sent).toMatchObject({ codPais: "US", nombrePais: "Estados Unidos", tipoPersona: 2, complemento: "100 Example Street, Miami, FL 33101", telefono: "+13055550100" });
    expect(sent.direccion).toBeUndefined();
  });
  it("ignores what another type left behind", () => {
    const sent = typedReceptor("01", { nombre: "Ana", nrc: "123456", codActividad: "10712", tipoPersona: "1" });
    expect(sent).toEqual({ nombre: "Ana" });
  });
  it("matches the same typed fields the server validates for each preset (wire round trip)", () => {
    for (const type of ["01", "03", "11", "14"]) {
      for (const preset of presetsFor(type)) {
        if (type === "01" && isEmptyForm(type, preset.fields)) continue;
        const built = buildCustomReceptor(type, typedReceptor(type, preset.fields)) as unknown as Record<string, unknown>;
        expect(built.nombre).toBe(preset.fields.nombre);
      }
    }
  });
});

describe("the checklist and the gate on «Preparar la venta»", () => {
  it("an empty crédito fiscal lacks every requirement", () => {
    const list = receptorChecklist("03", {});
    expect(list.title).toBe("un crédito fiscal");
    expect(list.items.map((i) => i.label)).toEqual(["Nombre", "NIT válido (o DUI de 9 dígitos)", "NRC", "Actividad económica", "Departamento, municipio y dirección", "Correo"]);
    expect(list.missing).toBe(6);
  });
  it("ticks live: removing the activity leaves exactly one missing", () => {
    const f = { ...presetsFor("03")[0]!.fields, codActividad: "", descActividad: "" };
    const list = receptorChecklist("03", f);
    expect(list.missing).toBe(1);
    expect(list.items.find((i) => !i.ok)?.id).toBe("actividad");
    expect(missingText(1)).toBe("Falta 1 dato.");
    expect(missingText(3)).toBe("Faltan 3 datos.");
  });
  it("a Factura with no data is a Consumidor final: nothing missing and no receiver sent", () => {
    expect(receptorChecklist("01", {}).missing).toBe(0);
    expect(receptorChecklist("01", {}).consumerFinal).toBe(true);
    expect(receptorForSale("01", { ...EMPTY_CHOICE, source: "custom", typed: {} })).toBeUndefined();
  });
  it("a Factura that starts a receiver must finish it", () => {
    expect(receptorChecklist("01", { numDocumento: "123" }).missing).toBeGreaterThan(0);
    expect(receptorChecklist("01", { tipoDocumento: "13", numDocumento: "01234567-8" }).missing).toBe(1); // the name
    expect(receptorChecklist("01", { nombre: "Ana", departamento: "06" }).missing).toBe(1); // half an address
  });
  it("FEX needs country, person type and address abroad", () => {
    const f = { ...presetsFor("11")[0]!.fields, tipoPersona: "" };
    expect(receptorChecklist("11", f).items.find((i) => !i.ok)?.id).toBe("persona");
  });
  it("a wrong check digit is missing, not accepted", () => {
    const f = { ...presetsFor("03")[0]!.fields, numDocumento: "0614-170892-101-4" };
    expect(receptorChecklist("03", f).items.find((i) => i.id === "documento")?.ok).toBe(false);
  });
  it("receptorMissing only counts the custom source", () => {
    expect(receptorMissing("03", { ...EMPTY_CHOICE, source: "demo" })).toBe(0);
    expect(receptorMissing("03", { ...EMPTY_CHOICE, source: "custom" })).toBe(6);
  });
  it("every type that has DOCS keeps the rules the page had", () => {
    expect(DOCS["03"]!.map(([code]) => code)).toEqual(["36", "13"]);
    expect(DOCS["14"]!.map(([code]) => code)).toEqual(["13", "36", "37"]);
  });
});

describe("the JSON preview", () => {
  it("shows «falta» where a required value is still missing, and commas only between members", () => {
    const f = { ...presetsFor("03")[0]!.fields, codActividad: "", descActividad: "" };
    const lines = previewLines("03", f);
    expect(lines.find((l) => l.key === "codActividad")?.comment).toBe("// falta");
    expect(lines.find((l) => l.key === "descActividad")?.comment).toBe("// falta");
    expect(lines.at(-1)).toMatchObject({ key: "telefono" });
    expect(lines.at(-1)!.comma).toBeUndefined();
    expect(lines.find((l) => l.key === "nombre")?.comma).toBe(true);
    const close = lines.find((l) => l.brace === "}")!;
    expect(close.comma).toBe(true);
  });
  it("a Factura with no data says it is a Consumidor final", () => {
    expect(previewLines("01", {})).toHaveLength(1);
    expect(previewLines("01", {})[0]!.comment).toContain("Consumidor final");
  });
});
