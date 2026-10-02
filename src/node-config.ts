import { readFile } from "node:fs/promises";
import { Facta, type FactaConfigV1, type FactaOptions } from "./client.ts";
import { validateFactaConfig } from "./config-validation.ts";

export type FactaNodeConfigOptions = Omit<FactaOptions, "config"> & {
  /** Explicit path to a JSON file containing a FactaConfigV1 object. */
  configFile: string;
  /** Programmatic profile values override matching file values. */
  config?: FactaConfigV1;
};

/**
 * Create a Node client from an explicitly selected JSON profile. Credentials
 * and runtime adapters are supplied separately and are never loaded from the
 * file. Programmatic config values override file values; undefined values are
 * ignored by the object merge.
 */
export async function createFactaFromConfigFile(
  options: FactaNodeConfigOptions,
): Promise<Facta> {
  if (
    typeof options.configFile !== "string" || options.configFile.trim() === ""
  ) {
    throw new TypeError("configFile must be a non-empty explicit path.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(options.configFile, "utf8"));
  } catch (cause) {
    throw new TypeError(
      `Could not read Facta config file: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  const fileConfig = validateConfigShape(parsed);
  const config = {
    ...fileConfig,
    ...Object.fromEntries(
      Object.entries(options.config ?? {}).filter(([, value]) =>
        value !== undefined
      ),
    ),
  } as FactaConfigV1;
  validateFactaConfig(config);
  const { configFile: _configFile, config: _configOverride, ...clientOptions } =
    options;
  return new Facta({ ...clientOptions, config });
}

function validateConfigShape(value: unknown): FactaConfigV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Facta config file must contain a JSON object.");
  }
  validateFactaConfig(value);
  return value;
}
