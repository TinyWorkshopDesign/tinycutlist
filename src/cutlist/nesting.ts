// Cutting plans: the parts of a cut list nested onto sheets and bars with
// PackingSolver (Florian Fontan, MIT), through its WebAssembly `solve`.
//
// Parts are grouped by material and thickness (sheets) or material and
// section (bars); each group is one PackingSolver instance. Sheets are cut
// with a saw (guillotine cuts, three stages); bars are cut to length.
// PackingSolver works in integers: sizes go in as tenths of a millimeter.

import type { CutList } from "./count.ts";
import { keyOf, resolve, type Resolved, type Stock } from "./stock.ts";

/** PackingSolver's `solve(problemType, instanceJson, parametersJson)`, answering JSON. */
export type Solver = (problemType: string, instanceJson: string, parametersJson: string) => string | Promise<string>;

export type PlacedPart = {
  label: string;
  name: string;
  /** Millimeters from the sheet's corner, x along its length. */
  x: number;
  y: number;
  /** The part's own length and width. */
  length: number;
  width: number;
  /** Turned a quarter: its length runs across the sheet. */
  rotated: boolean;
};
export type Rect = { x: number; y: number; length: number; width: number };

export type SheetLayout = { length: number; width: number; count: number; parts: PlacedPart[]; offcuts: Rect[]; efficiency: number };
export type BarLayout = { length: number; count: number; parts: { label: string; name: string; x: number; length: number }[]; efficiency: number };

export type CutGroup = {
  material: string | null;
  kind: "sheet" | "bar";
  /** Sheets: the parts' thickness, mm. */
  thickness?: number;
  /** Bars: the parts' section, width × thickness in mm. */
  section?: [number, number];
  stock: Resolved;
  sheets: SheetLayout[];
  bars: BarLayout[];
  /** Parts bigger than any stock size. */
  tooBig: { label: string; count: number }[];
  error?: string;
  seconds: number;
};

export type CutPlan = {
  groups: CutGroup[];
  /** Parts of materials set to `list`: no diagram. */
  listOnly: { label: string; count: number; material: string | null }[];
};

const S = 10;
const PARAMS = JSON.stringify({ optimization_mode: "not-anytime-sequential" });
const r1 = (v: number) => Math.round(v * 10) / 10;

type Item = { label: string; name: string; length: number; width: number; count: number };

export async function planCuts(res: CutList, stock: Stock, solve: Solver): Promise<CutPlan> {
  const groups = new Map<string, { material: string | null; stock: Resolved; thickness?: number; section?: [number, number]; items: Item[] }>();
  const listOnly: CutPlan["listOnly"] = [];
  for (const p of res.parts) {
    const st = resolve(stock, p.material, p.materialType);
    const [length, width, thickness] = [...p.size].sort((a, b) => b - a);
    if (st.kind === "list") {
      listOnly.push({ label: p.label, count: p.count, material: p.material });
      continue;
    }
    const key = st.kind === "sheet" ? JSON.stringify([keyOf(p.material), thickness]) : JSON.stringify([keyOf(p.material), width, thickness]);
    const g = groups.get(key) ?? {
      material: p.material, stock: st,
      ...(st.kind === "sheet" ? { thickness } : { section: [width, thickness] as [number, number] }),
      items: [],
    };
    g.items.push({ label: p.label, name: p.name, length, width, count: p.count });
    groups.set(key, g);
  }

  const out: CutGroup[] = [];
  for (const g of groups.values()) {
    const t0 = Date.now();
    const group: CutGroup = { material: g.material, kind: g.stock.kind as "sheet" | "bar", stock: g.stock, sheets: [], bars: [], tooBig: [], seconds: 0 };
    if (g.thickness !== undefined) group.thickness = g.thickness;
    if (g.section) group.section = g.section;
    try {
      if (group.kind === "sheet") await nestSheets(g.items, g.stock, solve, group);
      else await nestBars(g.items, g.stock, solve, group);
    } catch (e: any) {
      group.error = e.message;
    }
    group.seconds = (Date.now() - t0) / 1000;
    out.push(group);
  }
  out.sort((a, b) => (a.material ?? "~").localeCompare(b.material ?? "~") || (b.thickness ?? 0) - (a.thickness ?? 0));
  return { groups: out, listOnly };
}

async function run(solve: Solver, type: string, instance: object): Promise<string> {
  const res = JSON.parse(await solve(type, JSON.stringify(instance), PARAMS));
  if (res.error) throw new Error(`PackingSolver: ${res.error}`);
  return res.certificate as string;
}

const csvRows = (certificate: string) => certificate.trim().split("\n").slice(1).map((l) => l.split(","));

async function nestSheets(items: Item[], st: Resolved, solve: Solver, group: CutGroup) {
  const t = st.trim;
  const sizes = st.sheets.filter(([l, w]) => l > 2 * t && w > 2 * t);
  const fits = (it: Item) =>
    sizes.some(([l, w]) => (it.length <= l - 2 * t && it.width <= w - 2 * t) || (!st.grain && it.width <= l - 2 * t && it.length <= w - 2 * t));
  const fitting = items.filter(fits);
  group.tooBig = items.filter((it) => !fits(it)).map((it) => ({ label: it.label, count: it.count }));
  if (!fitting.length) return;
  const total = fitting.reduce((n, it) => n + it.count, 0);
  const trim = Math.round(t * S);
  const certificate = await run(solve, "rectangleguillotine", {
    objective: sizes.length === 1 ? "bin-packing-with-leftovers" : "variable-sized-bin-packing",
    cut_type: "non-exact",
    number_of_stages: 3,
    cut_thickness: Math.round(st.kerf * S),
    bin_types: sizes.map(([l, w]) => ({
      width: Math.round(l * S), height: Math.round(w * S), copies: total, cost: l * w,
      left_trim: trim, right_trim: trim, bottom_trim: trim, top_trim: trim,
      left_trim_type: "hard", right_trim_type: "hard", bottom_trim_type: "hard", top_trim_type: "hard",
    })),
    // x runs along the sheet's length: with grain, a part's length stays along it
    item_types: fitting.map((it) => ({ width: Math.round(it.length * S), height: Math.round(it.width * S), copies: it.count, oriented: st.grain })),
  });
  const plates = new Map<string, SheetLayout>();
  for (const [plate, copies, , x, y, w, h, type, , parent] of csvRows(certificate)) {
    let s = plates.get(plate);
    if (!s) plates.set(plate, (s = { length: 0, width: 0, count: Number(copies), parts: [], offcuts: [], efficiency: 0 }));
    const rect = { x: Number(x) / S, y: Number(y) / S, length: Number(w) / S, width: Number(h) / S };
    const kind = Number(type);
    if (parent === "") {
      s.length = rect.length;
      s.width = rect.width;
    } else if (kind >= 0) {
      const it = fitting[kind];
      const rotated = it.length !== it.width && Math.round(rect.length * S) !== Math.round(it.length * S);
      s.parts.push({ label: it.label, name: it.name, x: rect.x, y: rect.y, length: it.length, width: it.width, rotated });
    } else if (kind === -3) {
      s.offcuts.push(rect); // what's left of the last sheet, uncut
    }
  }
  for (const s of plates.values()) {
    s.efficiency = r1((100 * s.parts.reduce((a, p) => a + p.length * p.width, 0)) / (s.length * s.width));
    group.sheets.push(s);
  }
}

async function nestBars(items: Item[], st: Resolved, solve: Solver, group: CutGroup) {
  const t = st.trim;
  const lengths = st.bars.filter((l) => l > 2 * t);
  const longest = Math.max(...lengths) - 2 * t;
  const fitting = items.filter((it) => it.length <= longest);
  group.tooBig = items.filter((it) => it.length > longest).map((it) => ({ label: it.label, count: it.count }));
  if (!fitting.length) return;
  const total = fitting.reduce((n, it) => n + it.count, 0);
  // the blade is added to every piece, and once to the bar's usable length
  const certificate = await run(solve, "onedimensional", {
    objective: lengths.length === 1 ? "bin-packing" : "variable-sized-bin-packing",
    bin_types: lengths.map((l) => ({ length: Math.round((l - 2 * t + st.kerf) * S), copies: total, cost: l })),
    item_types: fitting.map((it) => ({ length: Math.round((it.length + st.kerf) * S), copies: it.count })),
  });
  const bars = new Map<string, BarLayout>();
  for (const [kind, id, copies, pos, x] of csvRows(certificate)) {
    if (kind === "BIN") bars.set(pos, { length: lengths[Number(id)], count: Number(copies), parts: [], efficiency: 0 });
    else if (kind === "ITEM") {
      const it = fitting[Number(id)];
      bars.get(pos)!.parts.push({ label: it.label, name: it.name, x: r1(t + Number(x) / S), length: it.length });
    }
  }
  for (const b of bars.values()) {
    b.parts.sort((a, c) => a.x - c.x);
    b.efficiency = r1((100 * b.parts.reduce((a, p) => a + p.length, 0)) / b.length);
    group.bars.push(b);
  }
}

/** Sheets and bars used, counting identical layouts. */
export function totals(g: CutGroup): { stock: number; parts: number } {
  const layouts: { count: number; parts: unknown[] }[] = g.kind === "sheet" ? g.sheets : g.bars;
  return {
    stock: layouts.reduce((n, l) => n + l.count, 0),
    parts: layouts.reduce((n, l) => n + l.count * l.parts.length, 0),
  };
}
