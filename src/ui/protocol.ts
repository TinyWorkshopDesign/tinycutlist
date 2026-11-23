// What the window asks for and what it gets back. The same commands run behind
// two bridges: `tinycutlist serve` answers them over HTTP today (src/serve.ts),
// and from Hew's M3 on the plugin's background will answer them to its own
// window. The window only ever talks through a Bridge.

import type { CutList } from "../cutlist/count.ts";
import type { CutPlan } from "../cutlist/nesting.ts";
import type { Stock } from "../cutlist/stock.ts";

export type Summary = { parts: number; rows: number; glueUps: number; open: number; sheets: number; bars: number; guessed: number };

export type Info = {
  /** The model's name, as the window shows it. */
  title: string;
  /** Reading the document open in Hew (else a file in a private session). */
  live: boolean;
  /** "Show in Hew" works: only on the open document. */
  canShow: boolean;
  /** Where the stock is kept, in words ("~/.config/tinycutlist/stock.json", "the plugin's storage"). */
  stockWhere: string;
  version: string;
};

export type ExportFormat = "csv" | "md" | "json" | "html";

export type Commands = {
  info: { params: Record<string, never>; result: Info };
  /** The cut list and its plans. `refresh` reads the model again (else the last reading is reused, and only the plans are redone). */
  cut_list: { params: { refresh?: boolean }; result: { cutList: CutList; plan: CutPlan; summary: Summary; seconds: number } };
  get_stock: { params: Record<string, never>; result: { stock: Stock } };
  /** Merges the given entries into the stock (a null entry removes that material's entry). */
  set_stock: { params: { stock: Record<string, Stock[string] | null> }; result: { stock: Stock } };
  /**
   * Selects the first placement in Hew and frames it. `how`: "part" when the
   * part itself is selected, "outer" when Hew couldn't open the components
   * around it and its top-level component is selected instead.
   */
  show: { params: { placements: string[][] }; result: { shown: number; how: "part" | "outer" | "none" } };
  /** The cut list as a file. */
  export: { params: { format: ExportFormat; sep?: string; decimal?: string }; result: { name: string; mime: string; text: string } };
};

export type Command = keyof Commands;

export interface Bridge {
  call<C extends Command>(command: C, params: Commands[C]["params"]): Promise<Commands[C]["result"]>;
}
