# Salvaguarda de emergencia

[English guide](emergency.md) · [README en español](../README.es.md)

Facta guarda cada documento sellado en una copia temporal de una hora mientras
lo escribe en almacenamiento duradero. Si el servidor no logra guardarlo en
ningún sitio duradero, o toda la replicación que intentó el SDK falla, esa copia
temporal es la única que queda. La salvaguarda de emergencia es el último
recurso para que la API siga firmando y los archivos se guarden de todos modos.
El SDK no trae almacenamiento para esto: usted puede aportar una función. Es opcional.

Hay un segundo mecanismo, en el servidor: si nada se pudo guardar, Facta envía una copia de respaldo al correo del dueño (JSON más PDF, para importarlos después). `emergencyStore` es una salvaguarda adicional encima de esa.

## Cuándo se ejecuta

Solo en una emergencia, una vez por documento (sin repetir por
`codigoGeneracion`), nunca en una emisión normal y nunca por temporizador:

- La respuesta sellada trae una advertencia del servidor:
  `sin_almacenamiento_duradero` (sin almacenamiento duradero; solo la copia
  temporal), `sin_copia_en_servidor` (crítica: ni siquiera la copia temporal; el
  documento existe solo en la respuesta) o `copia_solo_temporal` (falló la
  escritura gestionada; solo la copia temporal). También cuenta cualquier código
  que empiece con `sin_` o contenga `temporal`.
- `issueAndArchive` replicó a destinos y **todos** fallaron.
- `issueAndArchive` no encontró ningún destino (ni copia gestionada, ni copia
  BYOS y con el archivo local incompleto).

Corre después de que existe el resultado fiscal y nunca convierte un documento
sellado en un error.

## Configure su función

```ts
import { Facta } from "@facta-dte/api";

const facta = new Facta({
  apiKey,
  runtime: {
    version: 1,
    emergencyStore: async (files, info) => {
      // files.archivoDte?: string   el Archivo DTE del receptor (ausente en contingencia)
      // files.jsonRaw: string       el JSON original almacenado
      // files.pdf: Uint8Array|null  el PDF
      // info: { codigoGeneracion, numeroControl, tipoDte, ambiente, fecEmi,
      //         reason, warnings, occurredAt }
      await guardarEnUnSitioSuyo(files, info); // lance un error si no pudo
    },
    onEmergency: ({ info, report }) => avisarAlEquipo(info, report), // opcional
  },
});
```

Los bytes salen de la respuesta; si la respuesta no los trae, el SDK los baja de
la copia temporal (`GET /v1/dte/{code}/file`) dentro de la hora. El SDK no los
envía a ningún otro lugar.

## Qué recibe de vuelta

El resultado de la emisión (y el `emission` y el resultado de `issueAndArchive`)
trae `emergency: { saved, reason, trigger, detail }` y, si su función corrió, una
entrada de `sdkWarnings`, `emergency_saved` o `emergency_failed`:

- `saved: true`: su función aceptó los archivos; `reason` es el disparador.
- `saved: false, reason: "not_configured"`: no configuró `emergencyStore` (es
  opcional; no se emite ninguna advertencia y `diagnose()` lo muestra como
  información simple). Facta envía una copia de respaldo al correo del dueño, y
  los archivos siguen en el resultado (`archivoDte`, `archivoJson`,
  `representacionGrafica`) por si quiere guardarlos también.
- `saved: false, reason: "store_failed"`: su función lanzó un error. Mismo
  consejo.

En React, `FactaReceipt` y la ventana del sello muestran un aviso («Este
documento no quedó en un almacenamiento permanente; se guardó en el respaldo de
emergencia» o «descárguelo ahora») y mantienen los botones de descarga.

## Recuperación y guía de operación

`facta.emergency.replicate(files, info)` reintenta la replicación normal con los
archivos que guardó su función: cada destino configurado o sincronizado y luego
el reporte de copia a Facta. Devuelve `{ stored, failed }` con los ids de los
destinos. El SDK no guarda nada: es su función la que recuerda qué está en
espera.

1. Suena una alerta (`onEmergency`, o `emergency_saved` en sus registros).
   Compruebe que los archivos existen donde los dejó su función.
2. Cuando se arregle el problema de almacenamiento, llame a `replicate` con esos
   archivos; una copia verificada en un destino es la prueba.
3. Solo entonces borre su copia de emergencia.
4. Si `saved` fue `false`, vaya al resultado que aún tiene, o descargue de la
   copia temporal dentro de la hora: `downloadDocument(code, "json")`, `"pdf"`.

Un ejemplo (no es código incluido): escribir en una carpeta suya.

```ts
import { mkdir, writeFile } from "node:fs/promises";

const emergencyStore = async (files, info) => {
  const dir = `./emergency/${info.ambiente}/${info.codigoGeneracion}`;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(`${dir}/raw.json`, files.jsonRaw, { mode: 0o600 });
  if (files.archivoDte) await writeFile(`${dir}/archivo-dte.json`, files.archivoDte, { mode: 0o600 });
  if (files.pdf) await writeFile(`${dir}/documento.pdf`, files.pdf, { mode: 0o600 });
  await writeFile(`${dir}/info.json`, JSON.stringify(info, null, 2), { mode: 0o600 });
};
```
