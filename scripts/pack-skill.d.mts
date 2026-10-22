// Types for scripts/pack-skill.mjs, so the playground's Vite config can import it under `strict`.
export const SKILL_NAME: string;
export const SKILL_DIR: string;
export const DEFAULT_OUT: string;
export function skillFiles(dir?: string): Array<{ name: string; data: Uint8Array }>;
export function makeZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array;
export function packSkill(out?: string): { out: string; files: number; bytes: number };
