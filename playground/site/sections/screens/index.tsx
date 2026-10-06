import { Placeholder } from "../placeholder.tsx";

// Batch B: the React screens gallery. Add one file per screen example in this
// folder and import it here; each example imports its own source with `?raw`.
export function Screens() {
  return (
    <Placeholder title="Pantallas React" batch="lote B">
      <p>
        Aquí vivirán las pantallas del SDK funcionando contra el API de pruebas: la ventana, el cajón y la
        factura en línea, el recibo, los listados de documentos y los selectores de clientes y productos.
      </p>
      <p>Mientras tanto, la ventana de emisión real está en <a href="/">Inicio</a>.</p>
    </Placeholder>
  );
}
