// Glue-up geometry on hand-made frames: no Hew needed.
// A frame is what `hew.query.signature` reports: origin at the minimum corner,
// extents along x ≥ y ≥ z (length, width, thickness).

import { test } from "node:test";
import assert from "node:assert/strict";
import { findGlueUps, joint, type Frame } from "../../src/cutlist/glue.ts";

/** A board lying along world x, width along y, thickness along z, minimum corner at `at` (meters). */
const flat = (at: number[], l: number, w: number, t: number): Frame => ({ origin: at, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], extents: [l, w, t] });

/** The same board turned by `deg` about world z and about world x (a board in any pose). */
function turned(f: Frame, degZ: number, degX: number): Frame {
  const rz = (v: number[]) => {
    const a = (degZ * Math.PI) / 180;
    return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
  };
  const rx = (v: number[]) => {
    const a = (degX * Math.PI) / 180;
    return [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
  };
  const r = (v: number[]) => rx(rz(v));
  return { origin: r(f.origin), x: r(f.x), y: r(f.y), z: r(f.z), extents: f.extents };
}

test("laminated: two boards face to face", () => {
  assert.equal(joint(flat([0, 0, 0], 0.7, 0.05, 0.025), flat([0, 0, 0.025], 0.7, 0.05, 0.025)), "laminated");
});

test("edge-glued: two boards edge to edge, same thickness, one plane", () => {
  assert.equal(joint(flat([0, 0, 0], 0.9, 0.12, 0.02), flat([0, 0.12, 0], 0.9, 0.15, 0.02)), "edge-glued");
});

test("a gap of a millimeter is not a glue joint", () => {
  assert.equal(joint(flat([0, 0, 0], 0.7, 0.05, 0.025), flat([0, 0, 0.026], 0.7, 0.05, 0.025)), null);
});

test("a cleat under a shelf: in contact, widths too different", () => {
  assert.equal(joint(flat([0, 0, 0], 0.5, 0.03, 0.02), flat([0, 0, 0.02], 0.5, 0.3, 0.018)), null);
});

test("a drawer box resting on a long shelf: lengths too different", () => {
  assert.equal(joint(flat([0.3, 0, 0.019], 0.5715, 0.381, 0.1778), flat([0, 0, 0], 1.27, 0.4001, 0.0191)), null);
});

test("boards end to end: lengths don't overlap", () => {
  assert.equal(joint(flat([0, 0, 0], 0.5, 0.1, 0.02), flat([0.5, 0, 0], 0.5, 0.1, 0.02)), null);
});

test("a board standing against another's edge, crosswise: not parallel", () => {
  const shelf = flat([0, 0, 0], 0.5, 0.3, 0.018);
  const rail: Frame = { origin: [0, 0, 0.018], x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0], extents: [0.3, 0.05, 0.018] };
  assert.equal(joint(shelf, rail), null);
});

test("edge boards of different thickness: not a panel", () => {
  assert.equal(joint(flat([0, 0, 0], 0.9, 0.12, 0.02), flat([0, 0.12, 0], 0.9, 0.12, 0.025)), null);
});

test("the same lamination in any pose", () => {
  for (const [z, x] of [[30, 0], [0, 50], [137, -71]]) {
    const a = turned(flat([1, 2, 3], 0.7, 0.05, 0.025), z, x);
    const b = turned(flat([1, 2, 3.025], 0.7, 0.05, 0.025), z, x);
    assert.equal(joint(a, b), "laminated", `turned ${z}° / ${x}°`);
  }
});

test("a panel of three boards: one glue-up, boards in order, blank size", () => {
  const boards = [flat([0, 0.27, 0], 0.9, 0.13, 0.02), flat([0, 0, 0], 0.9, 0.12, 0.02), flat([0, 0.12, 0], 0.9, 0.15, 0.02)];
  const g = findGlueUps(boards.map((frame) => ({ frame })));
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, "edge-glued");
  const ys = g[0].members.map((i) => boards[i].origin[1]);
  assert.ok(ys.join() === "0,0.12,0.27" || ys.join() === "0.27,0.12,0", `in order across the panel: ${ys}`);
  assert.deepEqual(g[0].size.map((v) => Math.round(v * 1000)), [900, 400, 20]);
});

test("two separate laminations stay two glue-ups", () => {
  const boxes = [
    flat([0, 0, 0], 0.7, 0.05, 0.025), flat([0, 0, 0.025], 0.7, 0.05, 0.025),
    flat([1, 0, 0], 0.7, 0.05, 0.025), flat([1, 0, 0.025], 0.7, 0.05, 0.025),
    flat([3, 0, 0], 0.7, 0.05, 0.025),
  ].map((frame) => ({ frame }));
  const g = findGlueUps(boxes);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map((x) => x.members.length), [2, 2]);
});

test("a lamination edge-glued to a third board is mixed", () => {
  const boxes = [flat([0, 0, 0], 0.7, 0.05, 0.025), flat([0, 0, 0.025], 0.7, 0.05, 0.025), flat([0, 0.05, 0], 0.7, 0.05, 0.025)].map((frame) => ({ frame }));
  const g = findGlueUps(boxes);
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, "mixed");
});
