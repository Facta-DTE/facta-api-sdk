# Preparar, revisar y luego firmar

[English guide](prepare-sign.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

`issue` hace todo en una llamada: reserva el número de control, arma el
documento, lo firma y lo manda a Hacienda. Algunas integraciones necesitan que
una persona o un sistema de aprobación vea el documento exacto, con los totales
que calculó Facta, antes de firmarlo. Para eso la API divide el trabajo en dos:
`prepare` y `sign`. Úselos solo cuando exista ese paso de revisión; si no,
`issue` es más sencillo y no gasta números en documentos que nadie firma.

## Qué hace cada paso

| | `prepare(request, options?)` | `sign(prepared, options?)` |
| --- | --- | --- |
| Ruta | `POST /v1/dte/prepare` | `POST /v1/dte/sign` |
| Alcance | `issue` | `issue` |
| Llave de firma | **no se envía**: no se abre el vault de firma | `X-Facta-Sign-Key` (su `signKey`) |
| Efecto | reserva un número de control y arma el documento canónico sin firmar con sus totales | firma ese documento y lo transmite a Hacienda |
| Devuelve | `PreparedDte` | `IssueResult` (`sellado` o `contingencia`) |

`PreparedDte` trae `estado: "preparado"`, `codigoGeneracion`, `numeroControl`,
`tipoDte`, `ambiente`, `totales`, `documento` y `prepareToken`.

El `prepareToken` no es una credencial: por sí solo no firma nada. Es un MAC
sobre el hash canónico del documento (calculado con las claves ordenadas), y su
único trabajo es garantizar que lo que se firma es exactamente lo que recibió
ese número. **Vence a los 15 minutos** de `prepare`.

## El flujo

```ts
import { Facta, FactaError, type DteRequest, type PreparedDte } from "@facta-dte/api";

// El proceso de quien revisa no necesita la llave de firma.
const preparer = new Facta({ apiKey: process.env.FACTA_API_KEY! });
// El proceso que firma, sí.
const signer = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });

const request: DteRequest = {
  tipoDte: "03",
  receptor: { customerId: "c_123" },
  items: [{ productId: "p_456", cantidad: 10 }],
};

const prepared: PreparedDte = await preparer.prepare(request, { idempotencyKey: "po-77:prepare" });
console.log(prepared.numeroControl, prepared.totales.totalPagar, prepared.totales.totalLetras);

// ... una persona aprueba, dentro de los 15 minutos ...

try {
  const result = await signer.sign(prepared, { idempotencyKey: "po-77:sign" });
  if (result.estado === "contingencia") console.log("Firmado; Hacienda confirmará después:", result.detalle);
} catch (error) {
  if (error instanceof FactaError && error.code === "prepare_token_invalid") {
    // Vencido, de otra llave de API, o el documento cambió. Prepare de nuevo.
  } else {
    throw error;
  }
}
```

Pase el `PreparedDte` a `sign` **sin cambios**. El SDK envía solo
`prepareToken` y `documento`; el servidor comprueba el MAC, así que un solo
centavo alterado se rechaza en lugar de firmarse. Si el objeto preparado viaja
entre procesos (una cola, una base de datos), guárdelo y recupérelo como JSON sin
transformar `documento`. Reordenar las claves se tolera porque el hash se calcula
con las claves ordenadas, pero cambiar cualquier valor no.

Las referencias de catálogo (`customerId`, `productId`) se resuelven antes de
`prepare`, igual que en `issue`; vea la [guía de catálogo](catalog.es.md).

## El paso de revisión

Muéstrele a quien revisa lo que calculó el servidor, nunca totales que usted
vuelva a calcular:

- `prepared.totales`: `totalGravada`, `totalIva`, `totalPagar`,
  `totalLetras`, …
- `prepared.documento`: el documento canónico completo (receptor, líneas,
  códigos).
- `prepared.numeroControl` y `prepared.codigoGeneracion`: el número ya está
  reservado.

Si quien revisa quiere un cambio, **no** edite `documento`. Corrija su petición
y llame a `prepare` otra vez; eso reserva otro número. Cada `prepare` sin su
`sign` deja un número reservado y sin usar que hay que justificar en los
registros fiscales, así que mantenga corta la revisión y no prepare por si
acaso.

## Idempotencia en los dos pasos

Las dos rutas exigen `Idempotency-Key`, y la API agrupa las llaves por llave de
API, no por ruta. Dé a cada paso su propia llave estable derivada del mismo
identificador de negocio (`po-77:prepare`, `po-77:sign`), para que repetir
cualquiera de los dos devuelva su respuesta guardada:

- repetir `prepare` con su llave y la misma petición devuelve el mismo
  `PreparedDte` (sin un segundo número);
- repetir `sign` con su llave y el mismo documento preparado devuelve el mismo
  `IssueResult`; así se recupera un `sign` cuya respuesta se perdió.

Vea [idempotency.es.md](idempotency.es.md) para las reglas generales.

## Qué puede salir mal

- **`prepare_token_invalid` (422)**: el token venció (15 minutos), es de otra
  llave de API o `documento` cambió. No se firmó nada. Prepare de nuevo.
- **`validation_failed` / `no_storage_destination` (422) en `prepare`**: los
  datos o la configuración de almacenamiento están mal; no se gastó número.
- **`sign_key_required` / `sign_key_invalid` (401) en `sign`**: quien firma no
  tiene `signKey` o tiene una equivocada. Varios intentos fallidos bloquean el
  vault (`sign_vault_locked`).
- **`mh_rejected` (422) en `sign`**: Hacienda rechazó el documento y el número se
  gastó; vea `error.spent` y `error.mhObservations`.
- **Un 202 de contingencia en `sign`**: firmado y pendiente con Hacienda;
  revíselo después con `getDocumentStatus(prepared.codigoGeneracion)`.
- **Preparado pero nunca firmado**: `getDocumentStatus` puede informar estados
  como `reservado`, `liberado` o `descartado` para las reservas. El ciclo exacto
  de una reserva abandonada lo decide el servidor; concílielo con sus registros y
  los de Facta.

## Relacionado

- [Patrones de idempotencia](idempotency.es.md) · [Catálogo de errores](errors.es.md)
- [Ventana de firma para React](react.md) (en inglés), que usa `issue` en un
  solo paso
- [Referencia de métodos](reference.es.md)
