# Crear, editar y desactivar clientes y productos

[English guide](catalog-write.md) · [Instantáneas de catálogo](catalog.es.md) · [README en español](../README.es.md)

Desde la 0.5.0 el SDK puede administrar los clientes y productos de la empresa
por el API: `createCustomer`, `updateCustomer`, `deactivateCustomer`,
`createProduct`, `updateProduct` y `deactivateProduct`. Está apagado hasta que la
empresa lo active, porque cambia quién puede leer el catálogo.

## Ediciones simultáneas: `ifMatch`

Cuando la empresa comparte su clave de datos, una ficha leída de una en una trae `revision`.
Páselo como `ifMatch` y la edición se aplica solo si nadie cambió la ficha mientras tanto:

```ts
const customer = await facta.getCustomer(id);
await facta.updateCustomer(id, { telefono: "22223333" }, { ifMatch: customer!.revision! });
// una revisión vieja lanza FactaError catalog_revision_conflict; details.revisionActual es la vigente
```

Un catálogo en texto plano no tiene revisión que comparar: ignora `ifMatch` y gana la última
escritura por campo enviado.

## Qué necesita

Las tres cosas, en este orden:

1. **Un catálogo en texto plano.** En Facta DTE vaya a **Cuenta → API** y pase el
   catálogo de la empresa de cifrado a texto plano.
2. **La casilla «Permitir administrar clientes y productos desde el API»**, en la
   misma pantalla.
3. **Una llave con el alcance `catalog:write`**, que se crea ahí mismo.

Si falta algo, el API responde y el SDK explica en español qué cambiar:

| Error | HTTP | Qué significa |
|---|---|---|
| `catalog_write_disabled` | 403 | La empresa no activó la administración del catálogo por el API. |
| `catalog_encrypted` | 409 | El catálogo está cifrado y esta llave no tiene acceso (`details.hint`): la persona titular comparte los datos con la llave (Cuenta → API) o guarda el catálogo sin cifrar. Una llave de solo lectura recibe `forbidden_scope` primero. |
| `forbidden_scope` | 403 | La llave no tiene `catalog:write`. |
| `validation_failed` | 422 | Un campo incumple una regla (el SDK revisa las mismas reglas antes de enviar). |

## Qué implica para la privacidad, sin rodeos

Hoy el catálogo de la empresa está cifrado con una clave que solo usted tiene, así
que Facta DTE no puede leer los nombres, documentos ni direcciones de sus clientes.
Un catálogo en texto plano es lo contrario: **Facta DTE puede leerlo**, y también
cualquier llave del API autorizada a leer el catálogo. Ese es el precio de que un
programa pueda agregar y editar registros sin su clave de cifrado. Actívelo solo si
lo necesita, deje `catalog:write` únicamente en los sistemas que de verdad editan el
catálogo y use llaves de solo lectura en todo lo demás. Las facturas ya emitidas
conservan sus propias reglas de privacidad.

## La lectura funciona en cualquier modo

Desde la 0.6 los métodos de lectura siempre van por el API (`GET /v1/customers`,
`GET /v1/products`), sea cual sea el modo del catálogo de la empresa, y no necesitan
`unlockKey`: el servidor lee solo un catálogo cifrado. `diagnose()` sigue informando el
`catalogMode` que anuncia la llave, a título informativo.

**El resultado es el mismo en cualquier modo.** Cada cliente y cada producto trae los
mismos campos como lo guarde la empresa: los dos nombres de cada dato (`nombre` y
`name`...), el tratamiento de IVA del producto (`tipoVenta` / `sale_class`), la dirección
completa (`distrito` y, si la hay, `pais`), los números como números y `activo` siempre
presente. `customerId` / `productId` al emitir los resuelve el servidor.

`diagnose()` informa el mismo `catalogMode`. Los registros desactivados no salen en
listas ni búsquedas; pase `includeInactive: true` para verlos.

## Ejemplos

```ts
const cliente = await facta.createCustomer(
  {
    nombre: "Laura Ortiz",
    tipoDocumento: "13",
    numDocumento: "04829316-5",
    direccion: { departamento: "06", municipio: "14", distrito: "01", complemento: "Colonia Escalón" },
    correo: "laura@example.com",
  },
  { idempotencyKey: `crm-cliente-${crmId}` },
);

await facta.updateCustomer(cliente.id, { telefono: "2222-3333" });

const producto = await facta.createProduct({
  descripcion: "Disco de corte 4 1/2",
  tipoItem: 1, // 1 bien, 2 servicio, 3 ambos: obligatorio, nunca se supone
  precioUni: 2.85,
  ivaIncluido: true,
  tipoVenta: "gravada", // o "exenta" / "no_sujeta"; si se omite, se lee como gravada
});

await facta.updateProduct(producto.id, { precioUni: 3.1 });
await facta.deactivateProduct(producto.id);
```

Los nombres de los campos son los que usa el resto de la API pública (`nombre`,
`numDocumento`, `precioUni`, `tipoVenta`...). Los nombres guardados (`name`,
`doc_number`, `unit_price`...) se siguen aceptando al enviar, y cada registro que
devuelve el SDK trae los dos nombres, en cualquier modo de catálogo.

Reglas que el SDK revisa antes de enviar y que el servidor también revisa: un
cliente necesita `nombre`; un DUI lleva 9 dígitos y un NIT 14 (se aceptan guiones y
se quitan antes de enviar); un NRC lleva de 1 a 8 dígitos; una `direccion` necesita
códigos de departamento, municipio y distrito y un `complemento`; un producto
necesita `descripcion`, `tipoItem` y un `precioUni` mayor que cero. `tipoVenta` es el
tratamiento de IVA del producto y viaja en cada línea que se emite con él. El SDK nunca
rechaza un valor que el servidor aceptaría. `FactaError` con
`code: "validation_failed"` y `status: 422` lista los problemas en
`details.issues`.

## Idempotencia

Pase `idempotencyKey` al crear (un id de su CRM, un número de pedido). Reintentar
con la misma llave nunca crea un segundo registro, ni siquiera tras reiniciar. Sin
ella, el SDK genera una y la reutiliza en sus propios reintentos de red. Cambiar y
desactivar se pueden repetir sin riesgo y no envían llave.

## Desactivar, no borrar

No existe el borrado definitivo. `deactivateCustomer` y `deactivateProduct` envían
`DELETE` y el registro se conserva con `active: false`: los documentos anteriores lo
siguen resolviendo, deja de aparecer en listas y búsquedas, y un producto
desactivado no se puede emitir. Para reactivarlo, envíe `{ activo: true }` con
`updateCustomer` o `updateProduct` (un `PATCH` a la API); vuelve a las listas y
se puede emitir otra vez. La aplicación web no lista los clientes desactivados,
así que la reactivación de un cliente se hace por la API.

```ts
const inactivos = await facta.listCustomers({ includeInactive: true });
await facta.deactivateCustomer(cliente.id);              // DELETE → activo: false
await facta.updateCustomer(cliente.id, { activo: true }); // PATCH  → activo: true
```

Si intenta crear un cliente con el documento de uno desactivado, la respuesta es
`catalog_duplicate` (409) con `details.id` y `details.activo: false`: reactívelo
en lugar de crear otro.

## Desde el navegador: el handler del servidor

El handler no expone escrituras a menos que usted lo pida:

```ts
const handler = createFactaHandler({
  facta,
  sessionSecret: process.env.FACTA_SESSION_SECRET!,
  capabilities: { catalog: "write" }, // por defecto: nada; "read" solo lee
  authorize: async (req, ctx) => esEditorDeCatalogo(await usuarioActual(req), ctx.action),
});
```

`catalog: "write"` añade `catalog.customers.create | update | deactivate` y
`catalog.products.create | update | deactivate`. Exige una función `authorize`:
`"session-only"` se rechaza al construir el handler, porque una escritura no tiene
sesión de compra que la respalde. Los cuerpos son `{ action, input }` (crear),
`{ action, id, input }` (cambiar) y `{ action, id }` (desactivar); al crear puede
ir `idempotencyKey`. Las respuestas son las mismas proyecciones enmascaradas de las
acciones de búsqueda. Los selectores (`FactaCustomerPicker`, `FactaProductPicker`)
funcionan en modo plano sin cambios.
