// A printable page: the parts list, the glue-ups, and a cutting plan per
// material, with its diagrams. One self-contained file: no scripts, no fonts.
// The Ko-fi button at the bottom shows on screen only.

import { thicknessNote, type CutList } from "./count.ts";
import { totals, type CutPlan } from "./nesting.ts";
import { NO_MATERIAL } from "./stock.ts";
import { barSvg, sheetSvg } from "./svg.ts";
import { KOFI_CSS, kofiButtonHtml } from "../support.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mm = (v: number) => String(Math.round(v * 10) / 10);
const dims = (s: number[]) => s.map(mm).join(" × ");
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

const CSS = `
:root { --ink:#1d1b18; --muted:#6b655c; --line:#d8d2c7; --paper:#fbfaf7; --stock:#ece6da; --part:#fffdf8; --partline:#5c4a32; --offcut:#b9ad98; --warn:#9a5b00; }
@media (prefers-color-scheme: dark) { :root { --ink:#ece8e1; --muted:#a39d93; --line:#3a3631; --paper:#1b1a18; --stock:#2b2824; --part:#3b342a; --partline:#d9c3a0; --offcut:#6b6253; --warn:#e3a54a; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--paper); color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 32px 0 8px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
h3 { font-size: 15px; margin: 20px 0 6px; } .muted { color: var(--muted); } .warn { color: var(--warn); }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
td.num, th.num { text-align: right; }
.layout { margin: 10px 0 18px; break-inside: avoid; }
.layout svg { display: block; width: 100%; height: auto; }
.layout svg.tcl-bar { max-height: 70px; }
.legend { font-size: 12px; color: var(--muted); margin-top: 4px; }
.tcl-stock { fill: var(--stock); stroke: var(--partline); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.tcl-trim { fill: none; stroke: var(--offcut); stroke-dasharray: 4 3; stroke-width: 1; vector-effect: non-scaling-stroke; }
.tcl-part { fill: var(--part); stroke: var(--partline); stroke-width: 1; vector-effect: non-scaling-stroke; }
.tcl-offcut { stroke: var(--offcut); stroke-width: 1; vector-effect: non-scaling-stroke; }
.tcl-hatch { stroke: var(--offcut); stroke-width: 1; vector-effect: non-scaling-stroke; }
.tcl-label { fill: var(--ink); font-weight: 600; } .tcl-size { fill: var(--muted); } .tcl-grain { fill: var(--muted); font-style: italic; }
footer.tcl-support { margin-top: 40px; padding-top: 12px; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; color: var(--muted); }
@media print { body { background: #fff; padding: 0; } h2 { break-after: avoid; } footer.tcl-support { display: none; } }
`;

/** Shown on screen, left out of the print. */
const SUPPORT = `<footer class="tcl-support"><span>TinyCutList is free and open source.</span>${kofiButtonHtml()}</footer>`;

export function formatHtml(title: string, res: CutList, plan: CutPlan): string {
  const out: string[] = [];
  const pieces = res.parts.reduce((s, p) => s + p.count, 0);
  out.push(`<h1>${esc(title)}</h1>`, `<p class="muted">${plural(pieces, "part", "parts")} in ${plural(res.parts.length, "row", "rows")}, made with TinyCutList.</p>`);

  const guessed = [...new Set(plan.groups.filter((g) => g.stock.guessed).map((g) => g.material ?? NO_MATERIAL))];
  if (guessed.length) {
    out.push(
      `<p class="warn">Stock sizes are guessed for ${guessed.map((m) => `<b>${esc(m)}</b>`).join(", ")}. ` +
        `Run <code>tinycutlist stock</code> on this model, then set your own sheets and bars in the stock file.</p>`,
    );
  }

  const mismatched = res.parts.filter((p) => p.thicknessMismatch);
  if (mismatched.length) {
    out.push(
      `<p class="warn">The thickness doesn't match the material for ${mismatched.map((p) => `<b>${esc(p.label)}</b>`).join(", ")}. ` +
        `Check these parts in the model before cutting: they're planned at the thickness they're drawn.</p>`,
    );
  }

  // the parts list
  out.push(`<h2>Parts</h2><div class="table-wrap"><table><thead><tr><th></th><th>Part</th><th class="num">Qty</th><th class="num">L</th><th class="num">W</th><th class="num">T</th><th>Material</th><th>Notes</th></tr></thead><tbody>`);
  for (const p of res.parts) {
    const notes = [p.mirrored ? "mirrored" : "", p.otherNames.length ? `also named ${p.otherNames.join(", ")}` : "", p.glueUps.length ? `glued up in ${p.glueUps.join(", ")}` : ""].filter(Boolean).join("; ");
    out.push(
      `<tr><td><b>${esc(p.label)}</b></td><td>${esc(p.name)}</td><td class="num">${p.count}</td>` +
        p.size.map((v) => `<td class="num">${mm(v)}</td>`).join("") +
        `<td>${esc(p.material ?? "—")}</td><td>${thicknessNote(p) ? `<span class="warn">${esc(thicknessNote(p))}</span>${notes ? "; " : ""}` : ""}${esc(notes)}</td></tr>`,
    );
  }
  out.push(`</tbody></table></div>`);

  if (res.glueUps.length) {
    out.push(
      `<h2>Glue-ups</h2><p class="muted">Each glue-up is cut as separate boards, listed above. Pick which boards go together, and how, so the grain matches before gluing.</p>`,
      `<div class="table-wrap"><table><thead><tr><th></th><th>Glue-up</th><th class="num">Qty</th><th>Blank</th><th>Boards</th></tr></thead><tbody>`,
      ...res.glueUps.map((g) => `<tr><td><b>${g.label}</b></td><td>${esc(g.name)}</td><td class="num">${g.count}</td><td>${dims(g.size)}</td><td>${g.kind}: ${esc(g.boards.join(" + "))}</td></tr>`),
      `</tbody></table></div>`,
    );
  }

  // the cutting plans
  out.push(`<h2>Cutting plans</h2>`);
  if (!plan.groups.length) out.push(`<p class="muted">Nothing to cut: every material is set to the parts list only.</p>`);
  const names = new Map(res.parts.map((p) => [p.label, p.name]));
  for (const g of plan.groups) {
    const t = totals(g);
    const what = g.kind === "sheet" ? `${mm(g.thickness!)} mm` : `section ${dims(g.section!)}`;
    const stockSizes = g.kind === "sheet" ? g.stock.sheets.map((s) => dims(s)).join(", ") : g.stock.bars.map(mm).join(", ");
    out.push(
      `<h3>${esc(g.material ?? NO_MATERIAL)}, ${what}</h3>`,
      `<p class="muted">${plural(t.stock, g.kind, `${g.kind}s`)} (stock ${stockSizes}), ${plural(t.parts, "part", "parts")}. ` +
        `Kerf ${mm(g.stock.kerf)}, trim ${mm(g.stock.trim)}${g.grain ? ", parts follow the grain" : ""}.` +
        `${g.stock.guessed ? ` <span class="warn">Stock guessed.</span>` : ""}</p>`,
    );
    if (g.error) out.push(`<p class="warn">Couldn't plan this group: ${esc(g.error)}</p>`);
    if (g.tooBig.length) out.push(`<p class="warn">Too big for this stock: ${g.tooBig.map((x) => `${esc(x.label)} ×${x.count}`).join(", ")}.</p>`);
    const layouts = g.kind === "sheet" ? g.sheets : g.bars;
    layouts.forEach((l, i) => {
      const counts = new Map<string, number>();
      for (const p of l.parts) counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
      const legend = [...counts].map(([lab, k]) => `<b>${esc(lab)}</b> ${esc(names.get(lab) ?? "")}${k > 1 ? ` ×${k}` : ""}`).join(" · ");
      const head = `${g.kind === "sheet" ? "Sheet" : "Bar"} ${i + 1}${l.count > 1 ? ` <b>×${l.count}</b>` : ""}: ${g.kind === "sheet" ? dims([(l as any).length, (l as any).width]) : mm(l.length)}, ${l.efficiency}% used`;
      const svg = g.kind === "sheet" ? sheetSvg(g.sheets[i], { trim: g.stock.trim, grain: g.grain }) : barSvg(g.bars[i], { trim: g.stock.trim, section: g.section });
      out.push(`<div class="layout"><div>${head}</div>${svg}<div class="legend">${legend}</div></div>`);
    });
  }
  if (plan.listOnly.length) {
    out.push(`<p class="muted">Parts list only, no plan: ${plan.listOnly.map((x) => `${esc(x.label)} ×${x.count} (${esc(x.material ?? NO_MATERIAL)})`).join(", ")}.</p>`);
  }
  if (res.open.length) out.push(`<p class="muted">Not closed solids, not measured: ${res.open.map((o) => `${esc(o.name ?? o.id)} ×${o.count}`).join(", ")}.</p>`);

  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}${KOFI_CSS}</style></head><body><main>\n${out.join("\n")}\n${SUPPORT}\n</main></body></html>\n`;
}
