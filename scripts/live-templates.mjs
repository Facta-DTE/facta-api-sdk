// Opt-in live check of the per-document template (`representacion`): list the
// templates, issue ONE test FE with a permitted catalogue template that prints
// per-sale data, download the letter and the ticket, and assert the sheet is a
// PDF, the applied template is the one requested and the markers appear.
//
// Nothing here is published: the report gets one allowlisted state, and a failure
// carries a fixed code. Ids, markers and PDF text stay in this process.
import assert from "node:assert/strict";

/** `representacion.datos` keys that take free single-line text (see the API's rg-representation validator). */
export const LIVE_TEXT_DATA_KEYS = Object.freeze([
  "mesa", "mesero", "cajero", "pedido", "bomba", "placa", "paciente", "expediente", "proximaCita",
  "medico", "registroProfesional", "ordenTrabajo", "entrega", "evento", "fechaEvento", "comentario",
  "proyecto", "entregable", "periodo",
]);
const MAX_MARKERS = 3;
// `mesa` allows ten characters, so a marker (prefix + 4 digits + index) stays below that.
const MARKER_PREFIX = "SDK";

/** The template one test FE of `tipoDte` can request: allowed, from the catalogue (deterministic tag), printing text data. */
export function pickLiveTemplate(listing, kind, tipoDte = "01") {
  return (listing?.plantillas ?? []).find((template) =>
    template.tipo === kind &&
    template.origen === "catalogo" &&
    template.permitida === true &&
    (template.tiposDte === undefined || template.tiposDte.includes(tipoDte)) &&
    Array.isArray(template.clavesDatos) &&
    template.clavesDatos.some((key) => LIVE_TEXT_DATA_KEYS.includes(key))
  );
}

/** One marker per text key the templates print (at most three), e.g. `{ mesa: "SDK48211" }`. The suffix comes from the run id. */
export function liveDataMarkers(templates, runId) {
  const suffix = String(runId).replace(/\D/g, "").slice(-4).padStart(4, "0");
  const markers = {};
  for (const template of templates) {
    for (const key of template.clavesDatos) {
      if (LIVE_TEXT_DATA_KEYS.includes(key) && markers[key] === undefined && Object.keys(markers).length < MAX_MARKERS) {
        markers[key] = `${MARKER_PREFIX}${suffix}${Object.keys(markers).length + 1}`;
      }
    }
  }
  return markers;
}

/** Text of a PDF, or null when the optional dependency is not installed. */
export async function pdfText(bytes) {
  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    return null;
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  let out = "";
  for (let page = 1; page <= doc.numPages; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent();
    out += content.items.map((item) => item.str ?? "").join(" ") + "\n";
  }
  await task.destroy();
  return out;
}

/**
 * Returns the report state. Throws on a real defect (an assertion, or the SDK's own
 * error); a server that predates the feature only produces a warning state.
 */
export async function validateLiveTemplates(facta, { runId, log = console.log }) {
  let listing;
  try {
    listing = await facta.listTemplates({ tipoDte: "01" });
  } catch (error) {
    if (error?.status === 404) {
      log("WARN templates: the staging API does not have the template routes yet");
      return "Warning (template routes not deployed on staging yet)";
    }
    throw error;
  }
  assert(Array.isArray(listing.plantillas), "the template list must be an array");
  const carta = pickLiveTemplate(listing, "carta");
  const ticket = pickLiveTemplate(listing, "ticket");
  const chosen = [carta, ticket].filter((template) => template !== undefined);
  if (chosen.length === 0) {
    log("WARN templates: no permitted catalogue template with data keys for this key's plan");
    return "Not run (no permitted template with data keys)";
  }
  const markers = liveDataMarkers(chosen, runId);
  const plantilla = {
    ...(carta === undefined ? {} : { carta: carta.id }),
    ...(ticket === undefined ? {} : { ticket: ticket.id }),
  };
  const emission = await facta.issue(
    { tipoDte: "01", items: [{ descripcion: "Facta API SDK template test", cantidad: 1, precioUni: 0.01 }], representacion: { plantilla, datos: markers } },
    { idempotencyKey: `sdk-live-${runId}-templates` },
  );
  assert.equal(emission.estado, "sellado", "the template test invoice must be sealed");
  assert.equal(emission.ambiente, "00", "the template test invoice must be in the test environment");
  const refused = (emission.advertencias ?? []).some((w) => typeof w === "object" && w !== null && w.codigo === "plantilla_no_aplicada");
  assert(!refused, "a permitted template must not produce plantilla_no_aplicada");

  let headerSeen = true;
  let textChecked = true;
  for (const [kind, template] of [["pdf", carta], ["ticket", ticket]]) {
    if (template === undefined) continue;
    const file = await facta.downloadDocument(emission.codigoGeneracion, kind);
    assert.match(new TextDecoder().decode(file.bytes.subarray(0, 5)), /^%PDF-/, "the sheet must be a PDF");
    if (file.plantilla === undefined) headerSeen = false;
    else assert.equal(file.plantilla, template.id, "the applied template must be the requested one");
    const text = await pdfText(file.bytes);
    if (text === null) { textChecked = false; continue; }
    const haystack = text.toLowerCase();
    for (const key of template.clavesDatos) {
      const marker = markers[key];
      if (marker !== undefined) assert(haystack.includes(marker.toLowerCase()), "a per-sale data marker is missing from the sheet");
    }
  }
  if (!headerSeen) {
    log("WARN templates: the applied-template header is not served yet");
    return "Warning (applied-template header not deployed yet)";
  }
  if (!textChecked) {
    log("WARN templates: the PDF text reader is not installed; markers were not checked");
    return "Warning (sheet text not checked)";
  }
  log("PASS templates: requested template applied, sheet text carries the per-sale data");
  return "Passed (template applied and data on the sheet)";
}
