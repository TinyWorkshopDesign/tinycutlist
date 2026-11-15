// What each material is cut from: sheets, bars, or nothing (parts list only).
//
// A stock file maps a material's name in the model to an entry. The global
// file (~/.config/tinycutlist/stock.json) carries over from one model to the
// next; a project's own file (--stock) overrides it, material by material.
// A material neither file knows gets an entry guessed from its name and type,
// marked `guessed`, so the user knows to check it.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MaterialType } from "./materials.ts";
import { PRESETS, presetFor } from "./presets.ts";

export type StockEntry = {
  /** sheet: cut from panels or boards (2D); bar: cut from lengths (1D); list: parts list only. */
  kind: "sheet" | "bar" | "list";
  /** Panel or board sizes, length × width in mm. */
  sheets?: [number, number][];
  /** Bar lengths in mm. */
  bars?: number[];
  /** Blade width, mm. */
  kerf?: number;
  /** Trimmed off each edge of a sheet, or each end of a bar, mm. */
  trim?: number;
  /** Parts keep their length along the sheet's length (veneered plywood, boards). */
  grain?: boolean;
  /** A preset's id (src/cutlist/presets.ts): its sheet sizes and grain, unless the entry sets its own. */
  preset?: string;
  /** Proposed by TinyCutList, not set by the user. */
  guessed?: boolean;
};

export type Stock = Record<string, StockEntry>;
export type Resolved = Required<Omit<StockEntry, "guessed" | "preset">> & { guessed: boolean; preset: string | null };

/** The key for parts with no material. */
export const NO_MATERIAL = "(no material)";

const DEFAULTS = {
  sheet: { sheets: [[2800, 2070]] as [number, number][], bars: [], kerf: 3.2, trim: 10, grain: false },
  bar: { sheets: [], bars: [3000], kerf: 3, trim: 10, grain: false },
  list: { sheets: [], bars: [], kerf: 0, trim: 0, grain: false },
};

const SHEET = /mdf|hdf|multistrat|compensat|truciol|melamin|nobilit|osb|pannell|plywood|contreplaqu|lamellar|listellar|betulla|birch|okum|pioppo|poplar|sheet|panel|board|corian/i;
const BAR = /listell|batten|lath|stud|regolo|morali|tubo|profil|barra|\bbar\b|trave|tondo|piatto|angolar/i;
const SOLID = /massell|solid|rovere|oak|faggio|beech|h[eê]tre|noce|walnut|frassino|\bash\b|ciliegio|cherry|acero|maple|abete|pino|pine|larice|douglas|teak|iroko|ch[eê]ne/i;
const OTHER = /metal|metallo|steel|acciaio|ferro|iron|inox|chrome|cromo|alumin|allumin|bronz|ottone|brass|copper|rame|plastic|gomma|rubber|vetro|glass|fabric|tessut|leather|pelle|color_|paint/i;

/** An entry proposed from the material's name and type, before the user sets it. */
export function guessEntry(name: string | null, type: MaterialType = "unknown"): StockEntry {
  const n = name ?? "";
  const p = presetFor(name);
  if (p) return { kind: "sheet", preset: p.id, sheets: p.sheets, kerf: 3.2, trim: 10, grain: p.grain, guessed: true };
  if (type === "sheet_good" || SHEET.test(n)) return { kind: "sheet", sheets: [[2800, 2070]], kerf: 3.2, trim: 10, grain: false, guessed: true };
  if (type === "dimensional" || BAR.test(n)) return { kind: "bar", bars: [3000], kerf: 3, trim: 10, guessed: true };
  if (type === "solid_wood" || SOLID.test(n)) return { kind: "sheet", sheets: [[2500, 200]], kerf: 3.2, trim: 10, grain: true, guessed: true };
  if (type === "edge" || type === "veneer" || OTHER.test(n)) return { kind: "list", guessed: true };
  // no material, or a name that says nothing: most hobby models are sheet goods
  return { kind: "sheet", sheets: [[2800, 2070]], kerf: 3.2, trim: 10, grain: false, guessed: true };
}

export const keyOf = (material: string | null) => material || NO_MATERIAL;

/** The entry for a material, with defaults filled in: from the stock, else guessed. */
export function resolve(stock: Stock, material: string | null, type: MaterialType = "unknown"): Resolved {
  const e = stock[keyOf(material)] ?? guessEntry(material, type);
  const preset = e.preset ? PRESETS.find((p) => p.id === e.preset) : undefined;
  if (e.preset && !preset) throw new Error(`stock entry for "${keyOf(material)}": unknown preset "${e.preset}"`);
  const kind = (["sheet", "bar", "list"] as const).includes(e.kind) ? e.kind : preset ? "sheet" : "list";
  const d = DEFAULTS[kind];
  return {
    kind,
    sheets: e.sheets?.length ? e.sheets : preset?.sheets ?? d.sheets,
    bars: e.bars?.length ? e.bars : d.bars,
    kerf: e.kerf ?? d.kerf,
    trim: e.trim ?? d.trim,
    grain: e.grain ?? preset?.grain ?? d.grain,
    guessed: !!e.guessed || !(keyOf(material) in stock),
    preset: preset?.id ?? null,
  };
}

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
