// Enumerates the SDK's public surface with the TypeScript compiler, so the coverage list can be checked against what the
// package really exports instead of against a list somebody keeps by hand.
//
// Keys:
//   mod:Name  server:Name  browser:Name  react:Name  node:Name  file-archive:Name    exports of each entry point
//   Facta#member                       every public method, getter and property of the client class
//   FactaOptions.prop …                the properties of the option bags (see OPTION_BAGS)
//   error:code                         each member of the FactaErrorCode union
//   action:name                        each action the server handler accepts
//   capability:name                    each key of FactaCapabilities

import { resolve } from "node:path";
import ts from "typescript";
import { CATALOG_WRITE_ACTIONS, INVALIDATION_ACTIONS, READ_ACTIONS } from "../../src/server/capabilities.ts";

const root = resolve(import.meta.dirname, "../..");

/** Entry points of package.json#exports, as the file that defines each. `node` and `react` also re-export `mod`. */
export const ENTRY_POINTS = [
  ["mod", "mod.ts"],
  ["server", "server.ts"],
  ["browser", "browser.ts"],
  ["react", "react.ts"],
  ["node", "node.ts"],
  ["file-archive", "src/file-archive.ts"],
] as const;

/** Interfaces whose properties are public options: each property is one key. [name, file defining it] */
export const OPTION_BAGS = [
  ["FactaOptions", "src/client.ts"],
  ["FactaConfigV1", "src/client.ts"],
  ["FactaRuntimeConfigV1", "src/client.ts"],
  ["CallOptions", "src/client.ts"],
  ["IssueOptions", "src/client.ts"],
  ["DownloadOptions", "src/client.ts"],
  ["DebugOptions", "src/client.ts"],
  ["FactaEmergencyApi", "src/client.ts"],
  ["FactaHandlerOptions", "src/server/handler.ts"],
  ["CreateFactaSessionInput", "src/server/session.ts"],
  ["CreateFactaInvalidationSessionInput", "src/server/session.ts"],
  ["FactaClientOptions", "src/browser/client.ts"],
  ["IssueFlowOptions", "src/browser/flow.ts"],
  ["UseFactaIssueOptions", "src/react/use-issue.ts"],
  ["FactaCapabilities", "src/server/capabilities.ts"],
] as const;

export interface Surface {
  keys: string[];
}

export function enumerateSurface(): Surface {
  const config = ts.readConfigFile(resolve(root, "tsconfig.react.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const files = [...ENTRY_POINTS.map(([, file]) => file), ...new Set(OPTION_BAGS.map(([, file]) => file)), "src/errors.ts", "src/server/capabilities.ts"].map((f) => resolve(root, f));
  const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const keys = new Set<string>();

  const moduleExports = (file: string) => {
    const source = program.getSourceFile(resolve(root, file));
    const symbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
    if (symbol === undefined) throw new Error(`cannot read ${file}`);
    return checker.getExportsOfModule(symbol);
  };

  // Exports. `node` re-exports everything of `mod`; keep only what it adds.
  const modNames = new Set(moduleExports("mod.ts").map((s) => s.name));
  for (const [entry, file] of ENTRY_POINTS) {
    for (const symbol of moduleExports(file)) {
      if (entry === "node" && modNames.has(symbol.name)) continue;
      keys.add(`${entry}:${symbol.name}`);
    }
  }

  const declared = (file: string, name: string): ts.Symbol => {
    const symbol = moduleExports(file).find((s) => s.name === name);
    if (symbol === undefined) {
      // Not exported (for example `DownloadOptions`): find it in the file's own scope.
      const source = program.getSourceFile(resolve(root, file))!;
      const locals = (source as unknown as { locals?: Map<string, ts.Symbol> }).locals;
      const local = locals?.get(name);
      if (local === undefined) throw new Error(`${name} not found in ${file}`);
      return local;
    }
    return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  };

  // The client class: every public instance member.
  const facta = declared("src/client.ts", "Facta");
  const instance = checker.getDeclaredTypeOfSymbol(facta);
  for (const member of checker.getPropertiesOfType(instance)) {
    if (member.name === "constructor" || member.name.startsWith("#")) continue;
    const modifiers = ts.getCombinedModifierFlags(member.declarations?.[0] as ts.Declaration);
    if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue;
    keys.add(`Facta#${member.name}`);
  }

  for (const [name, file] of OPTION_BAGS) {
    const type = checker.getDeclaredTypeOfSymbol(declared(file, name));
    for (const prop of checker.getPropertiesOfType(type)) keys.add(`${name}.${prop.name}`);
  }

  // Error codes: the members of the union.
  const codes = checker.getDeclaredTypeOfSymbol(declared("src/errors.ts", "FactaErrorCode"));
  if (!codes.isUnion()) throw new Error("FactaErrorCode is not a union");
  for (const member of codes.types) if (member.isStringLiteral()) keys.add(`error:${member.value}`);

  // The actions the server handler accepts: issuing, reads, invalidation and (behind a capability) catalog writes.
  for (const action of ["session.describe", "issue", "status", ...READ_ACTIONS, ...INVALIDATION_ACTIONS, ...CATALOG_WRITE_ACTIONS]) keys.add(`action:${action}`);

  return { keys: [...keys].sort() };
}
