import { Placeholder } from "../placeholder.tsx";

// Batch D: headless examples built with `@facta-dte/api/browser` and `useFactaIssue`.
export function Headless() {
  return (
    <Placeholder title="Mi propia implementación" batch="lote D">
      <p>
        Ejemplos con su propia interfaz sobre el cliente de navegador del SDK: un formulario de cobro, un
        teclado de punto de venta y un interruptor de crédito fiscal, cada uno con las pocas líneas que necesita.
      </p>
    </Placeholder>
  );
}
