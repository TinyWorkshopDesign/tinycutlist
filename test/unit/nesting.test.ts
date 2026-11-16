// Cutting plans with a stand-in solver: what goes to PackingSolver, and how its
// certificates are read back. The real solver is in test/solver/.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CutList, Part } from "../../src/cutlist/count.ts";
import { planCuts, totals, type Solver } from "../../src/cutlist/nesting.ts";
import { formatHtml } from "../../src/cutlist/html.ts";
import { formatPlanMarkdown } from "../../src/cutlist/format.ts";
import { barSvg, sheetSvg } from "../../src/cutlist/svg.ts";

const part = (label: string, name: string, size: [number, number, number], count: number, material: string | null): Part => ({
  label, name, object: `obj_${label}`, material, materialType: "unknown", size, mirrored: false, count, placements: [], otherNames: [], glueUps: [],
});
const list = (parts: Part[]): CutList => ({ parts, glueUps: [], open: [], lookAlike: [] });

/** Answers a fixed certificate, and keeps what it was asked. */
function fake(certificates: Record<string, string>): Solver & { calls: { type: string; instance: any; params: any }[] } {
  const calls: { type: string; instance: any; params: any }[] = [];
  const f = ((type: string, instance: string, params: string) => {
    calls.push({ type, instance: JSON.parse(instance), params: JSON.parse(params) });
    return JSON.stringify({ certificate: certificates[type] });
  }) as any;
  f.calls = calls;
  return f;
}

test("sheets: one instance per material and thickness, in tenths of a millimeter, with grain", async () => {
  const solve = fake({
    // a 1000 × 500 sheet, trims, part 0 turned (300 wide along x), part 1 plain, an offcut left
    rectangleguillotine: [
      "PLATE_ID,COPIES,NODE_ID,X,Y,WIDTH,HEIGHT,TYPE,CUT,PARENT",
      "0,2,0,0,0,10000,5000,0,0,",
      "0,2,1,100,100,3000,6000,0,1,0",
      "0,2,2,3100,100,4000,2000,1,1,0",
      "0,2,3,7100,100,2800,4800,-3,1,0",
    ].join("\n"),
  });
  const res = list([part("A", "Side", [600, 300, 18], 2, "Plywood"), part("B", "Shelf", [400, 200, 18], 2, "Plywood"), part("C", "Back", [400, 200, 6], 1, "Plywood")]);
  const stock = { Plywood: { kind: "sheet" as const, sheets: [[1000, 500]] as [number, number][], kerf: 3.2, trim: 10, grain: false } };
  const plan = await planCuts(res, stock, solve);
  assert.equal(solve.calls.length, 2, "18 mm and 6 mm are planned apart");
  const call = solve.calls[0];
  assert.equal(call.type, "rectangleguillotine");
  assert.equal(call.params.optimization_mode, "not-anytime-sequential");
  assert.equal(call.instance.objective, "bin-packing-with-leftovers");
  assert.equal(call.instance.cut_thickness, 32);
  assert.deepEqual([call.instance.bin_types[0].width, call.instance.bin_types[0].height, call.instance.bin_types[0].left_trim], [10000, 5000, 100]);
  assert.deepEqual(call.instance.item_types.map((i: any) => [i.width, i.height, i.copies, i.oriented]), [[6000, 3000, 2, false], [4000, 2000, 2, false]]);
  const g = plan.groups.find((x) => x.thickness === 18)!;
  assert.equal(g.sheets.length, 1);
  const s = g.sheets[0];
  assert.deepEqual([s.length, s.width, s.count], [1000, 500, 2]);
  assert.deepEqual(s.parts.map((p) => [p.label, p.x, p.y, p.rotated]), [["A", 10, 10, true], ["B", 310, 10, false]]);
  assert.deepEqual(s.offcuts, [{ x: 710, y: 10, length: 280, width: 480 }]);
  assert.equal(s.efficiency, 52);
  assert.deepEqual(totals(g), { stock: 2, parts: 4 });
});

test("sheets: parts bigger than every sheet are reported, not sent", async () => {
  const solve = fake({ rectangleguillotine: "PLATE_ID,COPIES,NODE_ID,X,Y,WIDTH,HEIGHT,TYPE,CUT,PARENT\n" });
  const res = list([part("A", "Top", [1200, 300, 18], 1, "Ply")]);
  const plan = await planCuts(res, { Ply: { kind: "sheet", sheets: [[1000, 500]], grain: true } }, solve);
  assert.equal(solve.calls.length, 0);
  assert.deepEqual(plan.groups[0].tooBig, [{ label: "A", count: 1 }]);
});

test("grain: oriented parts can't turn, so a part that only fits turned is too big", async () => {
  const solve = fake({ rectangleguillotine: "PLATE_ID,COPIES,NODE_ID,X,Y,WIDTH,HEIGHT,TYPE,CUT,PARENT\n0,1,0,0,0,10000,5000,0,0,\n" });
  const res = list([part("A", "Rail", [450, 300, 18], 1, "Oak ply"), part("B", "Stile", [700, 100, 18], 1, "Oak ply")]);
  // 1000 × 500 sheet, trim 10: a 450-long part fits along the length; with grain it can't stand across
  await planCuts(res, { "Oak ply": { kind: "sheet", sheets: [[1000, 500]], grain: true, trim: 10 } }, solve);
  assert.deepEqual(solve.calls[0].instance.item_types.map((i: any) => i.oriented), [true, true]);
});

test("bars: the kerf goes on every piece and once on the bar, trims at both ends", async () => {
  const solve = fake({ onedimensional: "TYPE,ID,COPIES,BIN,X,LX\nBIN,0,3,0,0,29830\nITEM,0,3,0,0,8670\nITEM,1,3,0,8670,5000\n" });
  const res = list([part("A", "Rail", [864, 40, 40], 3, "Pine batten"), part("B", "Short", [497, 40, 40], 3, "Pine batten")]);
  const plan = await planCuts(res, { "Pine batten": { kind: "bar", bars: [3000], kerf: 3, trim: 10 } }, solve);
  const call = solve.calls[0];
  assert.deepEqual(call.instance.bin_types.map((b: any) => b.length), [29830]);
  assert.deepEqual(call.instance.item_types.map((i: any) => i.length), [8670, 5000]);
  const b = plan.groups[0].bars[0];
  assert.deepEqual(plan.groups[0].section, [40, 40]);
  assert.deepEqual([b.length, b.count], [3000, 3]);
  assert.deepEqual(b.parts.map((p) => [p.label, p.x]), [["A", 10], ["B", 877]]);
});

test("list-only materials skip the plan; solver errors stay in their group", async () => {
  const bad = ((() => JSON.stringify({ error: "boom" })) as unknown) as Solver;
  const res = list([part("A", "Hinge", [50, 30, 10], 4, "Steel"), part("B", "Top", [600, 400, 18], 1, "MDF")]);
  const plan = await planCuts(res, {}, bad);
  assert.deepEqual(plan.listOnly, [{ label: "A", count: 4, material: "Steel" }]);
  assert.match(plan.groups[0].error!, /PackingSolver: boom/);
});

test("drawings and the page: to scale, y up, labelled, escaped, self-contained", async () => {
  const sheet = { length: 1000, width: 500, count: 1, efficiency: 50, offcuts: [], parts: [{ label: "A", name: "<Side>", x: 10, y: 10, length: 600, width: 300, rotated: false }] };
  const svg = sheetSvg(sheet, { trim: 10, grain: true });
  assert.match(svg, /viewBox="0 0 1000 500"/);
  assert.match(svg, /<rect class="tcl-part" x="10" y="190" width="600" height="300"\/>/, "PackingSolver's y runs up");
  assert.match(svg, /&lt;Side&gt;/);
  assert.match(svg, /grain →/);
  assert.match(barSvg({ length: 3000, count: 2, efficiency: 60, parts: [{ label: "B", name: "Rail", x: 10, length: 864 }] }, { trim: 10 }), /viewBox="0 0 3000 105"/);

  const solve = fake({ rectangleguillotine: "PLATE_ID,COPIES,NODE_ID,X,Y,WIDTH,HEIGHT,TYPE,CUT,PARENT\n0,1,0,0,0,10000,5000,0,0,\n0,1,1,100,100,6000,3000,0,1,0\n" });
  const res = list([part("A", "Side & top", [600, 300, 18], 1, null)]);
  const plan = await planCuts(res, {}, solve);
  const html = formatHtml("Cabinet <1>", res, plan);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Cabinet &lt;1&gt;<\/title>/);
  // the Ko-fi button: a plain link at the bottom, no outside script, left out of the print
  assert.match(html, /<footer class="tcl-support">.*<a class="tcl-kofi" href="https:\/\/ko-fi\.com\/K8C82AR8S0"/);
  assert.match(html, /@media print \{.*footer\.tcl-support \{ display: none; \} \}/);
  assert.match(html, /Stock sizes are guessed for <b>\(no material\)<\/b>/);
  assert.match(html, /Side &amp; top/);
  assert.doesNotMatch(html, /<script|src="https?:|<link[^>]+href="https?:|url\(https?:/, "no scripts, nothing loaded from elsewhere (a plain link is fine)");
  assert.equal(new Set(html.match(/id="[^"]+"/g)).size, html.match(/id="[^"]+"/g)!.length, "ids are unique in the page");
  assert.match(formatPlanMarkdown(plan), /\| \(no material\) \| 18 mm \| 2800 × 2070 \| 1 sheet \| 1 \| stock guessed \|/);
});
