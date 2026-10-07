# Crear, editar y desactivar clientes y productos

[English guide](catalog-write.md) · [Instantáneas de catálogo](catalog.es.md) · [README en español](../README.es.md)

Desde la 0.5.0 el SDK puede administrar los clientes y productos de la empresa
por el API: `createCustomer`, `updateCustomer`, `deactivateCustomer`,
`createProduct`, `updateProduct` y `deactivateProduct`. Está apagado hasta que la
empresa lo active, porque cambia quién puede leer el catálogo.

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
| `catalog_encrypted` | 409 | El catálogo sigue cifrado; el API no puede escribir en él. |
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

No tiene que elegir un camino. El SDK consulta `/v1/status` una vez, junto con el
descubrimiento de región que ya hace, y usa:

| `catalogMode` | Cómo leen `listCustomers`, `getCustomer`, `searchCustomers` y los de productos |
|---|---|
| `encrypted` | Descifran localmente la instantánea de la llave con `unlockKey`, como antes. |
| `readable` | Leen por el API (`GET /v1/customers`, `GET /v1/products`); sin `unlockKey`. Recurren a la instantánea solo si faltan las rutas y hay `unlockKey`. |
| `plain` | Leen por el API; siempre al día; sin `unlockKey`. |

```ts
const state = await facta.catalogState();
console.log(state.catalogMode); // "encrypted" | "readable" | "plain" | null
```

`diagnose()` informa el mismo `catalogMode`. Los registros desactivados no salen en
listas ni búsquedas; pase `includeInactive: true` para verlos.

## Ejemplos

```ts
const cliente = await facta.createCustomer(
  {
    name: "Laura Ortiz",
    doc_type: "13",
    doc_number: "04829316-5",
    address: { departamento: "06", municipio: "14", complemento: "Colonia Escalón" },
    email: "laura@example.com",
  },
  { idempotencyKey: `crm-cliente-${crmId}` },
);

await facta.updateCustomer(cliente.id, { phone: "2222-3333" });

const producto = await facta.createProduct({
  description: "Disco de corte 4 1/2",
  item_type: 1, // 1 bien, 2 servicio, 3 ambos: obligatorio, nunca se supone
  unit_price: 2.85,
  vat_included: true,
});

await facta.updateProduct(producto.id, { unit_price: 3.1 });
await facta.deactivateProduct(producto.id);
```

Reglas que el SDK revisa antes de enviar y que el servidor también revisa: un
cliente necesita `name`; un DUI lleva 9 dígitos y un NIT 14 (se aceptan guiones y
se quitan antes de enviar); un NRC lleva de 1 a 8 dígitos; una dirección necesita
códigos de departamento y municipio de dos dígitos y un `complemento`; un producto
necesita `description`, `item_type` y un `unit_price` no negativo. El SDK nunca
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
desactivado no se puede emitir. Reactivarlo se hace en la app de Facta.

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
