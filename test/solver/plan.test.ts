// Cutting plans with the real PackingSolver module (solver/dist). Skipped when
// it isn't installed: `npm run solver:fetch` or `npm run solver:build`.
// The checks are geometric, so they hold whatever layout the solver picks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CutList, Part } from "../../src/cutlist/count.ts";
import { planCuts, totals } from "../../src/cutlist/nesting.ts";
import { loadSolver, solverDir } from "../../src/solver.ts";

const skip = existsSync(join(solverDir(), "packingsolver.js")) ? false : "PackingSolver isn't installed (npm run solver:fetch)";
const part = (label: string, size: [number, number, number], count: number, material: string): Part => ({
  label, name: label, object: label, material, materialType: "unknown", size, mirrored: false, count, placements: [], otherNames: [], glueUps: [],
});
const list = (parts: Part[]): CutList => ({ parts, glueUps: [], open: [], lookAlike: [] });

test("sheets: every part placed once, inside the trims, kerf between parts, grain kept", { skip }, async () => {
  const parts = [part("A", [720, 560, 18], 4, "Birch"), part("B", [600, 400, 18], 6, "Birch"), part("C", [1200, 300, 18], 2, "Birch"), part("D", [400, 120, 18], 9, "Birch")];
  const kerf = 3.2, trim = 10;
  const plan = await planCuts(list(parts), { Birch: { kind: "sheet", sheets: [[1525, 1525]], kerf, trim, grain: true } }, await loadSolver());
  const g = plan.groups[0];
  assert.equal(g.error, undefined);
  assert.deepEqual(g.tooBig, []);
  const placed = new Map<string, number>();
  for (const s of g.sheets) {
    assert.deepEqual([s.length, s.width], [1525, 1525]);
    const rects = s.parts.map((p) => ({ ...p, w: p.rotated ? p.width : p.length, h: p.rotated ? p.length : p.width }));
    for (const r of rects) {
      assert.equal(r.rotated, false, `${r.label} follows the grain`);
      assert.ok(r.x >= trim - 1e-6 && r.y >= trim - 1e-6 && r.x + r.w <= s.length - trim + 1e-6 && r.y + r.h <= s.width - trim + 1e-6, `${r.label} inside the trims`);
      placed.set(r.label, (placed.get(r.label) ?? 0) + s.count);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const apart = a.x + a.w + kerf <= b.x + 1e-6 || b.x + b.w + kerf <= a.x + 1e-6 || a.y + a.h + kerf <= b.y + 1e-6 || b.y + b.h + kerf <= a.y + 1e-6;
        assert.ok(apart, `${a.label} and ${b.label} are a kerf apart`);
      }
  }
  assert.deepEqual(Object.fromEntries(placed), { A: 4, B: 6, C: 2, D: 9 });
  const area = parts.reduce((s, p) => s + p.size[0] * p.size[1] * p.count, 0);
  assert.ok(totals(g).stock >= Math.ceil(area / (1505 * 1505)), "no fewer sheets than the area needs");
});

test("bars: pieces in order, kerf between them, inside the trims; too-long parts reported", { skip }, async () => {
  const parts = [part("A", [864, 40, 40], 4, "Pine"), part("B", [496, 40, 40], 8, "Pine"), part("C", [3500, 40, 40], 1, "Pine")];
  const kerf = 3, trim = 10;
  const plan = await planCuts(list(parts), { Pine: { kind: "bar", bars: [3000], kerf, trim } }, await loadSolver());
  const g = plan.groups[0];
  assert.deepEqual(g.tooBig, [{ label: "C", count: 1 }]);
  let n = 0;
  for (const b of g.bars) {
    let end = trim - kerf;
    for (const p of b.parts) {
      assert.ok(p.x >= end + kerf - 1e-6, `${p.label} starts a kerf after the last piece`);
      end = p.x + p.length;
      n += b.count;
    }
    assert.ok(end <= b.length - trim + 1e-6, "inside the trims");
  }
  assert.equal(n, 12);
});
