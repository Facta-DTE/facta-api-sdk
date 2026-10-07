# Fijación de región

[English guide](region.md) · [README en español](../README.es.md) · [Referencia de métodos](reference.es.md)

La API de Facta corre en Supabase Edge Functions. Por defecto una Edge Function
se ejecuta en la región más cercana a quien llama, pero la base de datos de
Facta vive en una sola región (`us-west-2`). Una función que arranca lejos de la
base paga un viaje de ida y vuelta entre países por cada consulta, y emitir un
DTE hace muchas. Medido en `POST /v1/dte`: **7.2 s en promedio sin fijar,
4.3 s fijada**.

Por eso el SDK envía la cabecera `x-region` en cada petición, para que la
función corra junto a la base. Normalmente no tiene que hacer nada; esta guía
explica cómo se elige el valor, cómo cambiarlo o desactivarlo y cómo comprobar
qué región respondió de verdad.

## Cómo se elige la región

Para cada instancia de `Facta` el valor es, en este orden:

1. la opción `region` del constructor;
2. `config.region` (dentro de `config: { version: 1, ... }`);
3. la variable de entorno `FACTA_API_REGION` (leída de `process.env` en Node y
   Bun, de `Deno.env` en Deno; sin espacios y en minúsculas);
4. la `region` que anuncia `GET /v1/status`, leída **una vez por cliente**, sin
   prisa, en la primera petición; las primeras llamadas simultáneas comparten
   esa única lectura;
5. un valor de fábrica, `us-west-2`, para llaves `facta_test_` y `facta_live_`,
   cuando la API no anuncia región.

Un texto tiene que tener forma de región de Supabase (`us-west-2`,
`sa-east-1`…); cualquier otra cosa hace que el constructor lance `TypeError`.
`false` (o `FACTA_API_REGION=false` / `off`) desactiva la cabecera.

```ts
import { Facta } from "@facta-dte/api";

// Por defecto: descubrir desde /v1/status.
const facta = new Facta({ apiKey: process.env.FACTA_API_KEY! });

// Región fija, sin petición de descubrimiento:
const pinned = new Facta({ apiKey: process.env.FACTA_API_KEY!, region: "us-west-2" });

// Lo mismo con la configuración versionada:
const configured = new Facta({ apiKey: process.env.FACTA_API_KEY!, config: { version: 1, region: "us-west-2" } });

// Sin cabecera x-region:
const unpinned = new Facta({ apiKey: process.env.FACTA_API_KEY!, region: false });
```

## La petición de descubrimiento

El descubrimiento es un `GET /v1/status` adicional antes de la primera petición
real de un cliente. Es un solo intento (sin reintentos) con un plazo de
`min(timeoutMs, 5 s)`, y ese mismo documento de estado le dice al SDK el modo de
catálogo de la llave, así que las lecturas de catálogo posteriores normalmente
no necesitan otra consulta de estado. `/v1/status` tiene su propia ventana de
límite de peticiones en el servidor.

Si el descubrimiento falla (error de red, tiempo agotado, cualquier error de la
API), la operación que lo provocó **no falla**: se envía sin `x-region` y el
descubrimiento se vuelve a intentar a los 60 segundos. Fijar la región es una
optimización, nunca un requisito.

Fije `region` explícitamente cuando quiera evitar esa petición adicional, por
ejemplo en una función serverless de vida corta que crea una instancia de
`Facta` en cada invocación.

## Comprobar qué se está usando

```ts
const region = await facta.region();   // "us-west-2", o null si está desactivada o falló el descubrimiento
await facta.status();
console.log(facta.servedRegion);       // región que respondió la última petición, p. ej. "us-west-2"

const report = await facta.diagnose();
console.log(report.region, report.servedRegion);
```

- `await facta.region()` devuelve el valor que envía el cliente, o `null` cuando
  está desactivada o falló el último descubrimiento. Nunca lanza.
- `facta.servedRegion` es la región que atendió la última respuesta, leída de
  la cabecera `x-sb-edge-region`; `null` antes de cualquier respuesta o cuando
  la cabecera no viene.
- `diagnose()` informa las dos como `region` y `servedRegion`.

Si `servedRegion` no coincide con `region`, probablemente la cabecera no se
respetó (un proxy que la quita, por ejemplo); las llamadas siguen funcionando,
solo que más lentas.

## Navegador y handler del servidor

El cliente de navegador (`@facta-dte/api/browser`) y los componentes de React
hablan con **su** servidor, nunca con Facta, así que no necesitan región. La
instancia de `Facta` de su servidor es la que fija la región.

## Qué puede salir mal

- **`TypeError: region must be a Supabase region such as 'us-west-2', or false.`**:
  la opción, `config.region` o `FACTA_API_REGION` traen otra cosa.
- **Permisos de Deno**: leer `FACTA_API_REGION` requiere `--allow-env` (por
  ejemplo `--allow-env=FACTA_API_REGION`). El SDK envuelve la lectura en
  `try`/`catch`; en una ejecución no interactiva sin el permiso se comporta como
  si la variable no existiera. Pase `region` explícitamente para evitar la
  pregunta.
- **La primera llamada tarda más de lo esperado**: incluye la petición de
  descubrimiento. Fije `region` para saltarla.
- **`region()` devuelve `null` aunque no la desactivó**: falló el
  descubrimiento; el SDK reintenta a los 60 s. Compruebe la conexión con
  `facta.status()`.
- **La base de datos cambia de región**: el valor de fábrica está en
  `src/client.ts` (`DEFAULT_REGIONS`). Lo que anuncia `/v1/status` tiene
  prioridad, así que una API actualizada mantiene correctos a los clientes sin
  actualizar el SDK.

## Relacionado

- [Tiempos de depuración](timings.es.md): mida dónde gasta el tiempo una llamada
  lenta.
- [Diagnóstico](diagnose.es.md) · [Referencia de métodos](reference.es.md)
