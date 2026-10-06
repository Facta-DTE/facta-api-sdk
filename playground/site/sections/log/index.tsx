import { Placeholder } from "../placeholder.tsx";

// A later batch: the visitor's own documents, read from the API.
export function Log() {
  return (
    <Placeholder title="Registro" batch="lote posterior">
      <p>
        El historial de las facturas que usted emitió desde el playground, con su estado y los enlaces a
        sus archivos. Se lee del API; el playground no guarda documentos.
      </p>
    </Placeholder>
  );
}
