import { FactaError } from "./errors.ts";
import type { CatalogSnapshot, Recipient, DteRequest } from "./types.ts";

/** Resolve SDK-only catalog references without sending IDs to the fiscal API. */
export function resolveCatalogRefs(
  request: DteRequest,
  catalog: CatalogSnapshot,
  revision: number,
): DteRequest {
  const customerId = request.receptor !== undefined && request.receptor !== null &&
      "customerId" in request.receptor &&
      typeof request.receptor.customerId === "string"
    ? request.receptor.customerId
    : undefined;
  let receptor = request.receptor;
  if (customerId !== undefined) {
    const customer = catalog.customers.find((row) => row.id === customerId);
    if (customer === undefined) {
      throw new FactaError(
        "not_found",
        "Customer was not found in this key’s snapshot. Sync the catalog from the Facta app.",
        404,
        { customerId, catalogRevision: revision },
      );
    }
    const { customerId: _customerId, ...explicit } = request.receptor as Recipient;
    const stored: Record<string, unknown> = {
      ...(typeof customer.name === "string" ? { nombre: customer.name } : {}),
      ...(typeof customer.doc_type === "string"
        ? { tipoDocumento: customer.doc_type }
        : {}),
      ...(typeof customer.doc_number === "string"
        ? { numDocumento: customer.doc_number }
        : {}),
      ...(typeof customer.nrc === "string" ? { nrc: customer.nrc } : {}),
      ...(typeof customer.activity_code === "string"
        ? {
          codActividad: customer.activity_code,
          descActividad: "Actividad económica registrada en Hacienda",
        }
        : {}),
      ...(customer.address !== null && typeof customer.address === "object"
        ? { direccion: customer.address }
        : {}),
      ...(typeof customer.phone === "string" ? { telefono: customer.phone } : {
        telefono: null,
      }),
      ...(typeof customer.email === "string" ? { correo: customer.email } : {}),
    };
    receptor = { ...stored, ...explicit } as Recipient;
  }

  const items = request.items.map((item) => {
    if (typeof item.productId !== "string") return item;
    const product = catalog.products.find((row) =>
      row.id === item.productId && row.active !== false
    );
    if (product === undefined) {
      throw new FactaError(
        "not_found",
        "Product was not found or is inactive in this key’s snapshot.",
        404,
        { productId: item.productId, catalogRevision: revision },
      );
    }
    const { productId: _productId, ...explicit } = item;
    const itemType = Number(product.item_type);
    if (itemType !== 1 && itemType !== 2 && itemType !== 3) {
      throw new FactaError("invalid_request", "Catalog product has an invalid item type; correct it before issuing.", 422, {
        productId: product.id,
      });
    }
    const unitOfMeasure = Number(product.unit_of_measure) || 59;
    if (!Number.isInteger(unitOfMeasure) || unitOfMeasure < 1) {
      throw new FactaError("invalid_request", "Catalog product has an invalid unit of measure; correct it before issuing.", 422, {
        productId: product.id,
      });
    }
    if (explicit.precioUni === undefined && request.tipoDte !== "14") {
      const expectsVatIncludedPrice = request.tipoDte === "01";
      if (typeof product.vat_included !== "boolean" || product.vat_included !== expectsVatIncludedPrice) {
        throw new FactaError("invalid_request", "Catalog price uses a VAT basis different from this DTE. Provide an explicit precioUni in the document’s basis or adjust vat_included in Facta.", 422, {
          productId: product.id,
          tipoDte: request.tipoDte,
          vatIncluded: product.vat_included ?? null,
        });
      }
    }
    return {
      ...explicit,
      descripcion: explicit.descripcion ?? String(product.description ?? ""),
      precioUni: explicit.precioUni ?? Number(product.unit_price),
      codigo: explicit.codigo ??
        (typeof product.code === "string" ? product.code : null),
      tipoItem: explicit.tipoItem ?? itemType,
      uniMedida: explicit.uniMedida ?? unitOfMeasure,
    };
  });
  return {
    ...request,
    ...(receptor === undefined ? {} : { receptor }),
    items,
  } as DteRequest;
}
