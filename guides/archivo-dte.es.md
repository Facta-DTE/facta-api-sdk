# El Archivo DTE: el archivo que recibe su cliente

[English guide](archivo-dte.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

Cuando Hacienda sella un documento, quien lo recibe (su cliente, su contador)
espera un solo archivo JSON: el **Archivo DTE**. Es el documento firmado con dos
miembros añadidos al final: `firmaElectronica` (el JWS compacto, byte por byte)
y `selloRecibido` (el sello de Hacienda). Esta guía explica dónde le entrega el
SDK ese archivo, en qué se diferencia del original guardado y qué pasa cuando
todavía no hay sello.

## Dos archivos JSON, dos usos

| | Archivo DTE | Original guardado («raw») |
| --- | --- | --- |
| Forma | las claves propias del documento, luego `firmaElectronica`, luego `selloRecibido`, con sangría de dos espacios | `{ codigoGeneracion, ambiente, jws }` |
| Dónde está en un resultado sellado | `result.archivoDte` (texto) | `result.archivoJson` (texto) |
| Descarga | `downloadDocument(code, "json")` (por defecto) | `downloadDocument(code, "json", { raw: true })` |
| Para quién | el receptor, un contador, la importación en otro sistema | su propio archivo; es lo que guardan el SDK y el archivo local |
| Existe en contingencia | no (no hay sello) | sí |

El archivo local (`issueAndArchive`), la réplica BYOS y la salvaguarda de
emergencia siguen guardando el original exactamente igual que antes. Cambiar la
descarga por defecto no cambió lo que se archiva.

## Desde el resultado de una emisión

`SealedDte.archivoDte` es el texto UTF-8 exacto que armó la API. No viene en
contingencia ni en servidores de la API anteriores a ese campo.
`archivoDteOf(result)` devuelve `archivoDte` cuando viene; si no, arma los
mismos bytes a partir de `jws` + `selloRecibido` (toma el documento de la carga
del JWS y, si no puede, de `documento`), o devuelve `null` cuando no hay sello.

```ts
import { Facta, archivoDteOf, type DteRequest } from "@facta-dte/api";
import { writeFile } from "node:fs/promises";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });
const sale: DteRequest = { tipoDte: "01", items: [{ descripcion: "Café", cantidad: 1, precioUni: 2.5 }] };

const result = await facta.issue(sale, { idempotencyKey: "order-1042" });
if (result.estado === "sellado") {
  const archivo = archivoDteOf(result); // texto; nunca null en un sellado con jws y sello
  if (archivo !== null) await writeFile(`${result.codigoGeneracion}.json`, archivo);
  // Conserve también el original, para su archivo:
  if (result.archivoJson) await writeFile(`${result.codigoGeneracion}.raw.json`, result.archivoJson);
}
```

`archivoDteOf` se exporta desde el paquete raíz y desde
`@facta-dte/api/browser`. Es una función pura, sin dependencias.

## Descargarlo después

`downloadDocument(code, "json")` devuelve el Archivo DTE por defecto.
`{ raw: true }` devuelve el original guardado y solo se acepta con `"json"` (con
`"pdf"` o `"ticket"` el SDK lanza `TypeError` antes de enviar nada). `jsonFormat`
le dice cuál de los dos mandó el servidor, leído de la cabecera
`X-Facta-Json-Format`; es `undefined` en servidores anteriores a esa cabecera.

```ts
const file = await facta.downloadDocument(code, "json");
const original = await facta.downloadDocument(code, "json", { raw: true });

console.log(file.jsonFormat);     // "archivo-dte"
console.log(original.jsonFormat); // "raw"
const text = new TextDecoder().decode(file.bytes);
```

`file.bytes` es un `Uint8Array` con los bytes exactos del servidor,
`file.filename` el nombre sugerido (o `null`) y `file.storageSource` el lugar
de donde lo leyó el servidor (`managed`, `holding` o `archive`) cuando lo
informa.

## Listar documentos con su DTE

`listDocuments({ include: ["dte"] })` devuelve cada fila con `archivoDte` (el
mismo texto de `downloadDocument(code, "json")`) y `resumen`, en una sola
llamada a la API. Pide el alcance `download` además de `query`; la página es de
20 filas por defecto y 25 como máximo (`include_limit_exceeded` si pide más).
El PDF y el ticket no vienen en la lista: descárguelos por fila cuando alguien
los pida.

```ts
const page = await facta.listDocuments({ include: ["dte"], limit: 20 });
for (const row of page.documentos) {
  if (row.resumen) console.log(row.resumen.receptor?.nombre, row.resumen.primeraDescripcion, row.resumen.totalPagar);
  else console.log(row.codigoGeneracion, row.dteError?.code, row.dteError?.message);
}
```

`resumen` es `summarizeArchivoDte(row.archivoDte)`: `{ receptor, lineas,
primeraDescripcion, totalIva, totalPagar }`, leído del documento legal y nunca
del receptor guardado en el índice, así que es idéntico tanto si la empresa
guarda su catálogo legible como cifrado. La función se exporta y es pura.

Un documento que la API no puede abrir por sí sola (emitido desde la app de
Facta, con copia solo en su propio almacenamiento) llega como
`dteError.code === "needs_local_decrypt"`. Con `unlockKey` configurada, el SDK
abre localmente la instantánea de sus destinos, lee el archivo (de cuatro en
cuatro) y devuelve la fila completa: la misma forma en ambos casos. Sin
`unlockKey`, la fila conserva un `dteError` que lo explica. Otros códigos:
`not_sealed`, `storage_unavailable`, `not_found`, `timeout`,
`destinations_unavailable`, `destination_read_failed`. Una fila con error nunca
hace fallar el listado, y un servidor que aún no conoce la bandera devuelve las
filas sin `archivoDte`.

## Contingencia y `not_sealed`

Un documento en contingencia está firmado pero no tiene `selloRecibido`, así que
no tiene Archivo DTE: el resultado de la emisión no trae `archivoDte`,
`archivoDteOf` devuelve `null` y la descarga JSON por defecto responde un
`FactaError` con código `not_sealed` (HTTP 409; `details.estado` dice el
estado). Pida el original guardado y descargue el Archivo DTE cuando
`getDocumentStatus` diga `sellado`.

```ts
import { FactaError } from "@facta-dte/api";

try {
  await facta.downloadDocument(code, "json");
} catch (error) {
  if (error instanceof FactaError && error.code === "not_sealed") {
    const original = await facta.downloadDocument(code, "json", { raw: true });
    // Guarde `original.bytes`; vuelva a pedir el Archivo DTE cuando llegue el sello.
  } else {
    throw error;
  }
}
```

## Componentes de React y el handler del servidor

`FactaReceipt`, `FactaDownloadButton` y la ventana sellada entregan el Archivo
DTE como «Descargar JSON». La prop `rawJson` añade una segunda opción, «JSON
original (raw)». El navegador no puede obtener el original a menos que su
handler del servidor también lo permita con `capabilities.rawJson: true` (por
defecto `false`); si no, `documents.download` con `raw` responde
`403 action_not_allowed`. La respuesta de emisión que el handler manda al
navegador incluye `archivoDte` siempre que la sesión permita descargas.

```ts
import { createFactaHandler } from "@facta-dte/api/server";

export const handler = createFactaHandler({
  facta,
  sessionSecret: process.env.FACTA_SESSION_SECRET!,
  authorize: (req) => isLoggedIn(req),
  capabilities: { downloads: ["pdf", "json"], rawJson: true },
});
// En React: <FactaDownloadButton codigoGeneracion={code} rawJson />
```

Vea [react.md](react.md) y [react-server.md](react-server.md#capabilities)
(en inglés) para la lista completa de componentes y permisos.

## Qué puede salir mal

- **`not_sealed` (409)** en una descarga JSON por defecto: el documento está en
  contingencia. Use `{ raw: true }` o espere el sello.
- **`TypeError: raw is only valid when downloading kind=json`**: se pasó `raw`
  con `"pdf"` o `"ticket"`.
- **`jsonFormat` viene `undefined`**: el servidor de la API es anterior a la
  cabecera. No suponga ninguno de los dos formatos; revise el JSON (si trae
  `firmaElectronica`, es un Archivo DTE).
- **Código que verificaba la forma antigua de la descarga deja de funcionar**:
  desde 0.5.0 la descarga JSON por defecto es el Archivo DTE. Pase
  `{ raw: true }` para seguir recibiendo `{ codigoGeneracion, ambiente, jws }`.
- **Volver a serializar `documento` por su cuenta**: no lo haga. La firma cubre
  los bytes del JWS; use `archivoDte`, `archivoDteOf` o la descarga.
- **Un documento emitido desde la aplicación web de Facta**: puede que la API
  no tenga su JSON firmado; la descarga puede responder `not_found`.

## Relacionado

- [Entrega por correo y WhatsApp](delivery.es.md): la API le envía el documento
  al receptor por usted.
- [Salvaguarda de emergencia](emergency.es.md): `files.archivoDte` y
  `files.jsonRaw`.
- [Catálogo de errores](errors.es.md) · [Referencia de métodos](reference.es.md)
