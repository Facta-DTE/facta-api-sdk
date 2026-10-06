import { Placeholder } from "../placeholder.tsx";

// Batch C: server recipes. A recipe is a fixed file under `playground/server/recipes/`
// shown with `?raw` and run by a Worker route; visitors never send code.
export function ServerRecipes() {
  return (
    <Placeholder title="Solo servidor" batch="lote C">
      <p>
        Recetas para quien nunca pone Facta en un navegador: emitir con idempotencia, preparar y firmar,
        consultar el estado, anular y descargar documentos, cada una con su botón «Ejecutar en pruebas».
      </p>
    </Placeholder>
  );
}
