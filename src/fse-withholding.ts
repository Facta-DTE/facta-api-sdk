import { FactaError, type FactaErrorCode } from "./errors.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function invalid(code: FactaErrorCode, message: string, field: string): never {
  throw new FactaError(code, message, 0, { field });
}

/** Validate opt-in withholding controls without mutating or resolving the request. */
export function validateFseWithholdingRequest(value: unknown): void {
  if (!isRecord(value)) return;
  const items = Array.isArray(value.items) ? value.items : [];
  const modePresent = hasOwn(value, "incomeWithholding");
  const legacyOwnPresent = hasOwn(value, "aplicarReteRenta");
  // JSON.stringify omits an optional property whose value is undefined. Preserve
  // the historical wire behavior outside new mode while still rejecting any
  // own legacy property alongside the explicitly selected per-line mode.
  const legacyPresent = legacyOwnPresent && value.aplicarReteRenta !== undefined;
  const flagged = items.map((item) => isRecord(item) && hasOwn(item, "applyIncomeWithholding"));
  const hasLineFlags = flagged.some(Boolean);
  const firstFlagIndex = flagged.findIndex(Boolean);

  if (modePresent && value.tipoDte !== "14") {
    invalid("fse_withholding_not_supported", "La retención por línea solo está disponible para documentos FSE (14).", "incomeWithholding");
  }
  if (legacyPresent && value.tipoDte !== "14") {
    invalid("invalid_request", "aplicarReteRenta solo está disponible para documentos FSE (14).", "aplicarReteRenta");
  }
  if (hasLineFlags && value.tipoDte !== "14") {
    invalid("fse_withholding_not_supported", "La selección de retención por línea solo está disponible para documentos FSE (14).", `items[${firstFlagIndex}].applyIncomeWithholding`);
  }
  if ((modePresent || hasLineFlags) && legacyOwnPresent) {
    invalid("fse_withholding_legacy_conflict", "No combine aplicarReteRenta con la retención por línea.", "aplicarReteRenta");
  }
  if (legacyPresent && typeof value.aplicarReteRenta !== "boolean") {
    invalid("invalid_request", "aplicarReteRenta debe ser true o false.", "aplicarReteRenta");
  }
  if (modePresent) {
    if (!isRecord(value.incomeWithholding)) {
      invalid("fse_withholding_mode_invalid", "incomeWithholding.mode debe ser 'per_line'.", "incomeWithholding.mode");
    }
    const unsupportedControl = Object.keys(value.incomeWithholding).find((key) => key !== "mode");
    if (unsupportedControl !== undefined) {
      invalid("fse_withholding_mode_invalid", "incomeWithholding solo admite la propiedad mode.", `incomeWithholding.${unsupportedControl}`);
    }
    if (value.incomeWithholding.mode !== "per_line") {
      invalid("fse_withholding_mode_invalid", "incomeWithholding.mode debe ser 'per_line'.", "incomeWithholding.mode");
    }
    if (!Array.isArray(value.items) || items.length === 0) {
      invalid("fse_withholding_selection_required", "La retención por línea requiere al menos una línea para validar.", "items");
    }
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const path = `items[${index}].applyIncomeWithholding`;
      if (!isRecord(item) || !hasOwn(item, "applyIncomeWithholding")) {
        invalid("fse_withholding_selection_required", "Cada línea debe indicar applyIncomeWithholding como booleano.", path);
      }
      if (typeof item.applyIncomeWithholding !== "boolean") {
        invalid("fse_withholding_selection_invalid", "applyIncomeWithholding debe ser true o false.", path);
      }
    }
    return;
  }
  if (hasLineFlags) {
    const index = flagged.findIndex(Boolean);
    invalid("fse_withholding_mode_required", "Las líneas con selección de retención requieren incomeWithholding.mode 'per_line'.", `items[${index}].applyIncomeWithholding`);
  }
}
