// Stock files on disk, for the command line: the global one
// (~/.config/tinycutlist/stock.json) and a project's own (--stock).
// Inside Hew the plugin keeps its stock in its own storage instead.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MaterialType } from "./cutlist/materials.ts";
import { guessEntry, keyOf, type Stock } from "./cutlist/stock.ts";

/** The global stock file: $TINYCUTLIST_CONFIG/stock.json, else ~/.config/tinycutlist/stock.json. */
export function globalStockPath(): string {
  const dir = process.env.TINYCUTLIST_CONFIG ?? join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "tinycutlist");
  return join(dir, "stock.json");
}

export function readStock(path: string): Stock {
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${path}: expected an object of material name → entry`);
  return raw as Stock;
}

/** The global file, then each given file over it, material by material. */
export function loadStock(paths: string[]): Stock {
  return Object.assign({}, ...paths.map(readStock));
}

/**
 * Adds an entry for each material the file doesn't have yet, guessed and marked
 * `guessed`, so the user can fill in their own sizes. Answers the names added.
 */
export function addMissing(path: string, materials: { name: string | null; type: MaterialType }[]): string[] {
  const stock = readStock(path);
  const added: string[] = [];
  for (const m of materials) {
    const k = keyOf(m.name);
    if (k in stock || added.includes(k)) continue;
    stock[k] = guessEntry(m.name, m.type);
    added.push(k);
  }
  if (added.length) {
    mkdirSync(dirname(path), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(stock).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(`${path}.tmp`, JSON.stringify(sorted, null, 2) + "\n");
    renameSync(`${path}.tmp`, path);
  }
  return added;
}
