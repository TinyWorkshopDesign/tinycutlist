// The plugin's bus commands, as plain handlers over a Host, so the same code
// runs inside Hew (src/plugin/main.ts wires them to the SDK) and in the tests
// (over recorded answers or hew-cli).

import type { Host } from "./host/host.ts";
import { countParts, type CountOptions, type CutList } from "./cutlist/count.ts";
import { planCuts, totals, type CutPlan, type Solver } from "./cutlist/nesting.ts";
import { render, type Format } from "./cutlist/render.ts";
import type { Stock } from "./cutlist/stock.ts";

export type Handler<P, R> = (host: Host, params: P) => Promise<R>;

export type CutListParams = CountOptions & {
  /** md (default), csv, json or html. html always has the cutting plans. */
  format?: Format;
  /** Add the cutting plans to md and json. */
  plan?: boolean;
  /** The page's title. */
  title?: string;
  /** Material name → entry, over the stock the plugin keeps. */
  stock?: Stock;
  /** CSV field separator and decimal mark. */
  sep?: string;
  decimal?: string;
};

export type CutListResult = {
  format: Format;
  text: string;
  summary: { parts: number; rows: number; glueUps: number; open: number; sheets: number; bars: number; guessed: number };
};

/** What cut_list needs besides the host: the solver, and the stock the plugin keeps. */
export type CutListDeps = { solver: () => Promise<Solver>; stock: () => Promise<Stock> };

const FORMATS: Format[] = ["md", "csv", "json", "html"];

export async function cutList(host: Host, params: CutListParams, deps: CutListDeps): Promise<CutListResult> {
  const format = params.format ?? "md";
  if (!FORMATS.includes(format)) throw new Error(`unknown format "${format}": use md, csv, json or html`);
  const wantPlan = format === "html" || (!!params.plan && format !== "csv");
  // start loading the solver while Hew answers the reads
  const solver = wantPlan ? deps.solver() : null;
  const res: CutList = await countParts(host, params);
  let plan: CutPlan | null = null;
  if (solver) plan = await planCuts(res, { ...(await deps.stock()), ...(params.stock ?? {}) }, await solver);
  const text = render(format, params.title ?? "Hew model", res, plan, params.sep, params.decimal);
  const groups = plan?.groups ?? [];
  const sum = (kind: "sheet" | "bar") => groups.filter((g) => g.kind === kind).reduce((s, g) => s + totals(g).stock, 0);
  return {
    format,
    text,
    summary: {
      parts: res.parts.reduce((s, p) => s + p.count, 0),
      rows: res.parts.length,
      glueUps: res.glueUps.reduce((s, g) => s + g.count, 0),
      open: res.open.length,
      sheets: sum("sheet"),
      bars: sum("bar"),
      guessed: groups.filter((g) => g.stock.guessed).length,
    },
  };
}

/** Contributed commands that need only the host, keyed by their ids in hew-plugin.json. */
export const commands = {
  count_parts: (async (host, params) => countParts(host, params)) as Handler<CountOptions, CutList>,
};
