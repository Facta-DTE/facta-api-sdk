# Reloj de referencia

[English guide](reference-clock.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

El reloj de un equipo puede estar adelantado o atrasado varios minutos. El SDK
mantiene su propio **reloj de referencia**, calibrado contra el servicio público
de hora de Facta, para las pocas cosas que sella o firma localmente. Esta guía
explica para qué se usa, para qué **no** se usa, cómo configurarlo y cómo usarlo
por separado.

## Qué sella y qué nunca toca

La fecha y la hora de un documento fiscal (`fecEmi`, `horEmi`) las pone el
servidor de Facta. **El reloj del SDK nunca pone ni cambia la fecha de un
documento.**

Se usa para:

- **Registros del archivo**: el `createdAt` de los diarios de `issueAndArchive`
  / `invalidateAndArchive`, el `updatedAt` de los registros de copias remotas y
  el `occurredAt` de un evento de emergencia.
- **Ventanas de seguridad**: el límite de 23 horas a partir del cual
  `recoverOperation` y `recoverInvalidation` se niegan a repetir una llave de
  idempotencia se mide con él.
- **La firma de peticiones a S3**, cuando lo comparte con un destino S3. S3
  rechaza una petición SigV4 firmada a más de 15 minutos de su propia hora
  (`RequestTimeTooSkewed`), así que un equipo con la hora mal no podría escribir.

`issue`, `prepare`, `sign` y los métodos de lectura no lo usan.

## Configurarlo en `Facta`

| Opción | Significado |
| --- | --- |
| `clock: true` (por defecto) | Calibrar contra `DEFAULT_CLOCK_URL` (`https://clock.factadte.com/`). |
| `clock: "https://…"` | Usar otro servicio que hable el mismo protocolo. |
| `clock: false` | Usar el reloj del equipo; `facta.clock` es `null`. |
| `clockFetch` | Un `fetch` que se usa solo para calibrar (por defecto, el `fetch` del cliente). |

Cualquier valor que no sea booleano ni texto hace que el constructor lance
`TypeError`.

```ts
import { Facta, createS3ArtifactDestination } from "@facta-dte/api";

const facta = new Facta({ apiKey: process.env.FACTA_API_KEY!, signKey: process.env.FACTA_SIGN_KEY! });

// Comparta el reloj del cliente con un destino compatible con S3; sin él, el
// destino calibra su propio reloj (o pase false para usar el reloj del equipo).
const s3 = createS3ArtifactDestination({
  id: "s3-backup",
  label: "Respaldo S3",
  config: {
    bucket: "my-invoices",
    region: "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  clock: facta.clock ?? false,
});

console.log(facta.clock?.state().status); // "device" hasta la primera calibración
```

Vea [storage-adapters.es.md](storage-adapters.es.md) para las opciones de S3.

## Cómo calibra

El protocolo son las cuatro marcas de tiempo de NTP. El SDK consulta el servicio
para **calibrar** y después contesta cada «qué hora es» con el reloj monótono,
sin llamadas de red:

- Una calibración es una ráfaga de **3 muestras**, separadas por 300 ms, y hasta
  5 mientras la mejor incertidumbre pase de 250 ms. Gana la muestra con menor
  demora de ida y vuelta; una muestra de más de 3 s, o con un eco que no
  coincide, se descarta. Cada petición tiene un límite de 3 s.
- Vuelve a calibrar solo cuando la incertidumbre pasa de **500 ms** (crece con
  una deriva supuesta de 100 ppm, o una medida), cuando la calibración es más
  vieja que el `nextSyncAfterMs` del servicio (6 horas por defecto) o cuando la
  hora del equipo salta más de 2 s.
- **Nunca lanza.** Si el servicio no responde, `now()` devuelve la mejor
  estimación disponible o, si no hay, el reloj del equipo, y `state().status` lo
  dice. Después de un fallo espera 60 s antes de volver a intentar, así que una
  operación nunca paga una ráfaga de esperas en cada llamada.

Las operaciones con archivo (`issueAndArchive`, `recoverOperation`,
`replicateArchive`, `invalidateAndArchive`) llaman primero a `ensure()`. En la
primera operación con archivo de un proceso eso **espera una ráfaga de
calibración** (normalmente bastante menos de un segundo; si el servicio no
responde, unos dos tiempos de espera de 3 segundos antes de usar el reloj del
equipo). Las llamadas siguientes contestan localmente.

## Usar un reloj por separado

`createReferenceClock(options)` crea un reloj independiente. Usted aporta el
servicio, un `fetch` y las dos fuentes de tiempo; lo demás tiene valores por
defecto.

```ts
import { createReferenceClock, DEFAULT_CLOCK_URL, type ClockState } from "@facta-dte/api";

const clock = createReferenceClock({
  url: DEFAULT_CLOCK_URL,
  fetch: globalThis.fetch.bind(globalThis),
  wallNow: () => Date.now(),
  monoNow: () => performance.now(),
});

const state: ClockState = await clock.ensure();       // calibra si hace falta; nunca lanza
console.log(clock.now().toISOString(), state.status, Math.round(state.uncertaintyMs), "ms");
await clock.calibrate();                              // fuerza una ráfaga, p. ej. tras un rechazo por la hora
```

`ReferenceClockOptions`:

| Campo | Por defecto | Significado |
| --- | --- | --- |
| `url`, `fetch`, `wallNow`, `monoNow` | obligatorios | Servicio, transporte, reloj de pared del equipo (ms desde la época), reloj monótono (ms). |
| `store` | ninguno | `{ load(), save(value) }` para conservar la última calibración entre recargas; una calibración cargada deja el reloj `provisional` hasta que vuelva a calibrar. |
| `sampleSpacingMs` | 300 | Separación entre las muestras de una ráfaga. |
| `timeoutMs` | 3000 | Límite por petición. |
| `retryCooldownMs` | 60000 | Espera después de una calibración fallida. |
| `random`, `sleep` | `Math.random`, `setTimeout` | Ganchos para pruebas. |

`ReferenceClock` tiene `now(): Date` (síncrono, sin red), `state(): ClockState`,
`ensure({ maxUncertaintyMs? })` y `calibrate()`.

`ClockState` informa `status` (`ClockStatus`: `"calibrated"`, `"provisional"` o
`"device"`), `offsetMs` (hora correcta menos hora del equipo), `uncertaintyMs`
(`Infinity` cuando es `device`), `driftPpm`, `driftMeasured`, `calibratedAt`,
`lastJumpMs`, `samples`, `delayMs`, `colo` (el centro de datos que respondió),
`nextSyncAfterMs` y `lastError`.

El tipo del valor del `store` y un almacén basado en `localStorage` existen en
`src/reference-clock.ts`, pero en esta versión no se exportan desde los puntos de
entrada del paquete; si necesita persistencia, escriba usted el objeto de dos
métodos.

## Qué puede salir mal

- **`state().status` se queda en `"device"`**: el servicio no responde
  (cortafuegos, sin conexión, `fetch` bloqueado). Los sellos del archivo usan
  entonces el reloj del equipo, igual que antes de que existiera el reloj de
  referencia. Revise `state().lastError` (`timeout`, `network`,
  `http_<estado>`, `echo_mismatch`…).
- **La primera operación con archivo tarda más**: incluye la primera
  calibración. Caliéntelo al arrancar con `await facta.clock?.ensure()`.
- **`RequestTimeTooSkewed` desde S3**: el destino no usa un reloj calibrado y la
  hora del equipo está mal. Pase `clock: facta.clock ?? false` o corrija la hora
  del equipo.
- **Salida de red o CSP restrictivas**: permita `https://clock.factadte.com/`,
  apunte `clock` a un servicio compatible propio o use `clock: false`.
- **Esperar que corrija la fecha de un documento**: no puede. Las fechas de los
  documentos vienen del servidor.

## Relacionado

- [Adaptadores de almacenamiento](storage-adapters.es.md) ·
  [Patrones de idempotencia](idempotency.es.md)
- [Referencia de métodos](reference.es.md)
