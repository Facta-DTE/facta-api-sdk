// The recipe files shown on the page: the text comes from `shown-files.ts`, so what the page shows is
// the file the Worker executes, and `recipePath` is the file «Ver en GitHub» links to.
import { SOURCES, type SourcePath } from "../../shown-files.ts";

/** Repository path of a recipe's file (`spec.file` is its name under `server/recipes/`). */
export const recipePath = (file: string): SourcePath => `playground/server/recipes/${file}` as SourcePath;

export const recipeSource = (file: string): string => SOURCES[recipePath(file)];
