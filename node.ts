// Node-only entry: importing the root package never loads filesystem modules.
export * from "./mod.ts";
export { FileInvoiceArchive } from "./src/file-archive.ts";
export {
  createFactaFromConfigFile,
  type FactaNodeConfigOptions,
} from "./src/node-config.ts";
