// Acceptance cases for layered materials, grain and top face (hew3d/hew#134,
// first round). What TinyCutList reads from Hew, as executable cases.
//
// The rule they check, as agreed on #134: the top face and the grain live on
// the SHARED solid, in its own frame. Each placement carries them through its
// own pose (world_pose), so a turned copy has turned grain and a mirrored copy
// keeps the grain line. The layered material itself sits on the placement.
// A copy that needs a different grain is made unique first.
//
// Grain is a line, not a direction: grain checks compare up to sign. The top
// face's normal is a direction: those checks keep the sign.

import { Hew, board, material, type Row } from "../linked-copies/hew.ts";
import * as links from "../linked-copies/adapter.ts";
import * as api from "./adapter.ts";
import type { Vec, Layer } from "./adapter.ts";

export class Fail extends Error {}
export const expect = (cond: unknown, msg: string): void => {
  if (!cond) throw new Fail(msg);
};

export type Case = {
  id: string;
  title: string;
  /** "now": true on current builds (validates the harness); "layers": needs #134's first round. */
  needs: "now" | "layers";
  run: (hew: Hew) => Promise<string | void>;
};

// ---------------------------------------------------------------- helpers

const MM = 0.001;
const TOL = 1e-6;

/** Plywood: `n` equal plies adding up to `total` metres, two alternating tones, "Face" on top, "Back" at the bottom. */
export function plywood(n: number, total: number): Layer[] {
  const tones: [number, number, number, number][] = [[226, 196, 150, 255], [196, 160, 112, 255]];
  return Array.from({ length: n }, (_, i) => ({
    thickness: total / n,
    color: tones[i % 2],
    ...(i === 0 ? { name: "Face" } : i === n - 1 ? { name: "Back" } : {}),
  }));
}

const melamine = (total: number): Layer[] => [
  { thickness: 0.2 * MM, color: [245, 245, 242, 255], name: "Face" },
  { thickness: total - 0.4 * MM, color: [190, 170, 140, 255], name: "Core" },
  { thickness: 0.2 * MM, color: [245, 245, 242, 255], name: "Back" },
];

const birch18 = (hew: Hew) => api.createLayered(hew, "Baltic birch 18", plywood(9, 18 * MM), true);

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => Math.sqrt(dot(a, a));
const unit = (a: number[]) => a.map((v) => v / norm(a)) as Vec;
const fmt = (a: number[]) => `[${a.map((v) => v.toFixed(3)).join(", ")}]`;

/** Same line (grain): parallel, either sign. */
function sameLine(a: number[], b: number[]) {
  return norm(a) > TOL && norm(b) > TOL && Math.abs(Math.abs(dot(unit(a), unit(b))) - 1) < 1e-6;
}
/** Same direction (top face normal). */
function sameDir(a: number[], b: number[]) {
  return norm(a) > TOL && norm(b) > TOL && Math.abs(dot(unit(a), unit(b)) - 1) < 1e-6;
}

/** The 3×3 linear part of a world_pose (3×4, row major). */
const rot = (m: number[]) => [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
const apply = (r: number[][], v: number[]): Vec => [dot(r[0], v), dot(r[1], v), dot(r[2], v)];
const applyT = (r: number[][], v: number[]): Vec => [0, 1, 2].map((j) => r[0][j] * v[0] + r[1][j] * v[1] + r[2][j] * v[2]) as Vec;

/**
 * What placement `b` should report, given what placement `a` reports, when
 * both carry one shared solid: back to the solid's frame through a's pose,
 * then out through b's. Poses are rigid or mirrored (orthogonal), so the
 * inverse is the transpose, and a face normal maps the same way as a vector.
 */
const carry = (v: number[], a: Row, b: Row) => apply(rot(b.world_pose), applyT(rot(a.world_pose), v));

const rowsNamed = async (hew: Hew, name: string) => (await hew.occurrences()).filter((r) => r.kind === "object" && r.name === name);
const loc = (r: Row) => [...r.path, r.id];

async function only(hew: Hew, name: string): Promise<Row> {
  const rows = await rowsNamed(hew, name);
  expect(rows.length === 1, `${name}: ${rows.length} placements, expected 1`);
  return rows[0];
}

async function frame(hew: Hew, r: Row) {
  const fresh = (await hew.occurrences()).find((x) => x.id === r.id && JSON.stringify(x.path) === JSON.stringify(r.path));
  expect(fresh, `placement ${loc(r).join("/")} is gone`);
  return { row: fresh!, frame: api.frameOf(fresh!) };
}

async function expectFrame(hew: Hew, r: Row, grain: Vec | null, up: Vec, what: string) {
  const { frame: f } = await frame(hew, r);
  expect(f, `${what}: no material frame reported`);
  if (grain) expect(sameLine(f!.grain, grain), `${what}: grain ${fmt(f!.grain)}, expected along ${fmt(grain)}`);
  expect(sameDir(f!.up, up), `${what}: top face normal ${fmt(f!.up)}, expected ${fmt(up)}`);
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-7;

// A 600 × 400 × 18 mm panel, corner at the origin. Its top face is at z = 18 mm.
const PANEL: [number, number, number] = [0.6, 0.4, 0.018];
const TOP_OF = (at: Vec, size: number[]): Vec => [at[0] + size[0] / 2, at[1] + size[1] / 2, at[2] + size[2]];
const X: Vec = [1, 0, 0], Y: Vec = [0, 1, 0], Z: Vec = [0, 0, 1];

/** A panel made of `mat`, its top face picked, as Paint's plain click does. */
async function plyPanel(hew: Hew, name: string, mat: string, at: Vec = [0, 0, 0], size: [number, number, number] = PANEL) {
  await board(hew, name, at, size);
  const r = await only(hew, name);
  await api.applyFromFace(hew, loc(r), TOP_OF(at, size), mat);
  return r;
}

// ---------------------------------------------------------------- cases

export const CASES: Case[] = [
  // ---------------------------------------------------------------- baseline (current builds)
  {
    id: "B1",
    title: "A plain board: part_frame doesn't claim a material source",
    needs: "now",
    async run(hew) {
      const wood = await material(hew, "Pine", [210, 180, 130]);
      await board(hew, "Shelf", [0, 0, 0], PANEL, wood);
      const r = await only(hew, "Shelf");
      const pf = await api.partFrame(hew, loc(r));
      expect(pf.source !== "material", `plain material, but part_frame source is "material"`);
      expect(pf.extents.length === 3, "part_frame should give three extents");
      return `source ${JSON.stringify(pf.source)}, extents ${fmt(pf.extents)}`;
    },
  },

  // ---------------------------------------------------------------- the material
  {
    id: "M1",
    title: "Plywood: 9 × 2 mm reads as layered, 9 layers, 18 mm, with grain",
    needs: "layers",
    async run(hew) {
      const id = await birch18(hew);
      const m = await api.materialInfo(hew, id);
      expect(m.kind === "layered", `kind ${JSON.stringify(m.kind)}, expected "layered"`);
      expect(m.layers.length === 9, `${m.layers.length} layers, expected 9`);
      expect(m.thickness !== undefined && close(m.thickness, 0.018), `thickness ${m.thickness}, expected 0.018 (the sum of the layers)`);
      expect(m.directional === true, "plywood should have a grain direction");
      expect(m.layers[0].name === "Face" && m.layers[8].name === "Back", "layers should come top to bottom, with their names");
    },
  },
  {
    id: "M2",
    title: "Melamine: three layers, no grain direction",
    needs: "layers",
    async run(hew) {
      const id = await api.createLayered(hew, "White melamine 19", melamine(19 * MM), false, [245, 245, 242]);
      const m = await api.materialInfo(hew, id);
      expect(m.kind === "layered" && m.layers.length === 3, `expected a layered material with 3 layers, got ${m.kind}/${m.layers.length}`);
      expect(m.thickness !== undefined && close(m.thickness, 0.019), `thickness ${m.thickness}, expected 0.019`);
      expect(m.directional === false, "melamine has no grain direction");
    },
  },
  {
    id: "M3",
    title: "Changing a ply changes the material's thickness (the total is never typed)",
    needs: "layers",
    async run(hew) {
      const id = await birch18(hew);
      const layers = plywood(9, 18 * MM);
      layers[4] = { ...layers[4], thickness: 3 * MM };
      await api.setLayers(hew, id, layers);
      const m = await api.materialInfo(hew, id);
      expect(m.thickness !== undefined && close(m.thickness, 0.019), `thickness ${m.thickness} after one ply went 2 → 3 mm; Kurt's outline expects 0.019`);
    },
  },
  {
    id: "M4",
    title: "A plain material still reads as plain",
    needs: "layers",
    async run(hew) {
      const id = await material(hew, "Pine", [210, 180, 130]);
      const m = await api.materialInfo(hew, id);
      expect(m.kind !== "layered", `a plain material reads ${JSON.stringify(m.kind)}`);
    },
  },

  // ---------------------------------------------------------------- applying it
  {
    id: "A1",
    title: "Apply on the top face: grain along its longest edge, top face up",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Side", birch);
      await expectFrame(hew, r, X, Z, "Side");
      const row = (await frame(hew, r)).row;
      expect(row.material === birch || row.material_effective === birch, "the part should now be made of the plywood");
    },
  },
  {
    id: "A2",
    title: "Apply from the underside: that face becomes the top",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      await board(hew, "Back", [0, 0, 0], PANEL);
      const r = await only(hew, "Back");
      await api.applyFromFace(hew, loc(r), [0.3, 0.2, 0], birch);
      await expectFrame(hew, r, X, [0, 0, -1], "Back");
    },
  },
  {
    id: "A3",
    title: "Applying is one undo step; undo leaves no frame",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Side", birch);
      await hew.one("hew.history.undo", {});
      const { frame: f } = await frame(hew, r);
      expect(f === null, `after undo the part still reports a frame (grain ${f && fmt(f.grain)})`);
    },
  },
  {
    id: "A4",
    title: "Melamine on a part: top face set, no grain reported",
    needs: "layers",
    async run(hew) {
      const mel = await api.createLayered(hew, "White melamine 19", melamine(19 * MM), false, [245, 245, 242]);
      const r = await plyPanel(hew, "Shelf", mel, [0, 0, 0], [0.6, 0.4, 0.019]);
      const { frame: f } = await frame(hew, r);
      expect(f && sameDir(f.up, Z), `top face normal ${f && fmt(f.up)}, expected +Z`);
      expect(!f || norm(f.grain) < TOL, `melamine has no grain, but the part reports ${fmt(f!.grain)}`);
    },
  },
  {
    id: "A5",
    title: "Swapping one plywood for another keeps the top face and grain",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const maple = await api.createLayered(hew, "Maple ply 18", plywood(7, 18 * MM), true, [230, 210, 170]);
      const r = await plyPanel(hew, "Door", birch);
      // a second click, on the long edge this time, with the other plywood
      await api.applyFromFace(hew, loc(r), [0.3, 0, 0.009], maple);
      await expectFrame(hew, r, X, Z, "Door after the swap");
      const row = (await frame(hew, r)).row;
      expect(row.material === maple || row.material_effective === maple, "the part should now be maple");
    },
  },

  // ---------------------------------------------------------------- what TinyCutList reads
  {
    id: "R1",
    title: "A short, wide rail: part_frame gives the length along the grain first",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      // 300 mm along X, 500 mm along Y: the grain runs along X, the short side
      const size: [number, number, number] = [0.3, 0.5, 0.018];
      const r = await plyPanel(hew, "Rail", birch, [0, 0, 0], size);
      await api.setFrame(hew, loc(r), { grain: X, down: [0, 0, -1] });
      await expectFrame(hew, r, X, Z, "Rail");
      const pf = await api.partFrame(hew, loc(r));
      expect(pf.source === "material", `part_frame source ${JSON.stringify(pf.source)}, expected "material"`);
      expect(close(pf.extents[0], 0.3) && close(pf.extents[1], 0.5) && close(pf.extents[2], 0.018),
        `extents ${fmt(pf.extents)}, expected [0.300, 0.500, 0.018] (length along the grain first)`);
    },
  },
  {
    id: "R2",
    title: "Grain runs along Width: the extents swap",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Side", birch);
      await api.setFrame(hew, loc(r), { grain: Y, down: [0, 0, -1] });
      const pf = await api.partFrame(hew, loc(r));
      expect(close(pf.extents[0], 0.4) && close(pf.extents[1], 0.6), `extents ${fmt(pf.extents)}, expected [0.400, 0.600, 0.018]`);
    },
  },
  {
    id: "R3",
    title: "Thickness mismatch: a 19 mm part on 18 mm plywood is reported, not refused",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const thick = await plyPanel(hew, "Thick", birch, [0, 0, 0], [0.6, 0.4, 0.019]);
      const right = await plyPanel(hew, "Right", birch, [0, 1, 0], PANEL);
      const m = api.mismatchOf((await frame(hew, thick)).row);
      expect(m && close(m.part, 0.019) && close(m.material, 0.018), `mismatch ${JSON.stringify(m)}, expected { part: 0.019, material: 0.018 }`);
      expect(api.mismatchOf((await frame(hew, right)).row) === null, "an 18 mm part on 18 mm plywood should report no mismatch");
    },
  },
  {
    id: "R4",
    title: "Push/pull a ply part to 20 mm: the mismatch appears",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Shelf", birch);
      await links.pushPullThrough(hew, loc(r), TOP_OF([0, 0, 0], PANEL), 0.002);
      const m = api.mismatchOf((await frame(hew, r)).row);
      expect(m && close(m.part, 0.02), `mismatch ${JSON.stringify(m)} after push/pull to 20 mm`);
      await expectFrame(hew, r, X, Z, "Shelf after push/pull");
    },
  },

  // ---------------------------------------------------------------- carried through cuts and moves
  {
    id: "C1",
    title: "Crosscut a 150 mm wide board to 100 mm long: the grain stays put",
    needs: "layers",
    async run(hew) {
      // Kurt's example on #134: a board crosscut shorter than it is wide must not flip its length
      const birch = await birch18(hew);
      const size: [number, number, number] = [0.6, 0.15, 0.018];
      const r = await plyPanel(hew, "Stile", birch, [0, 0, 0], size);
      await expectFrame(hew, r, X, Z, "Stile before the cut");
      const tool = await board(hew, "Saw", [0.1, -0.05, -0.01], [0.6, 0.25, 0.04]);
      await links.subtractThrough(hew, loc(r), tool);
      const after = await only(hew, "Stile");
      await expectFrame(hew, after, X, Z, "Stile after the crosscut");
      const pf = await api.partFrame(hew, loc(after));
      expect(close(pf.extents[0], 0.1) && close(pf.extents[1], 0.15),
        `extents ${fmt(pf.extents)} after the crosscut, expected [0.100, 0.150, 0.018] (length along the grain, though shorter)`);
    },
  },
  {
    id: "C2",
    title: "Turn a ply part 90° about Z: its grain turns with it",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Side", birch);
      await hew.one("hew.entity.rotate", { ids: [r.id], pivot: [0, 0, 0], axis: [0, 0, 1], angle: Math.PI / 2 });
      const after = await only(hew, "Side");
      await expectFrame(hew, after, Y, Z, "Side after the turn");
    },
  },
  {
    id: "C3",
    title: "Stand a ply part on its edge (90° about X): top face and grain follow",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Side", birch);
      await hew.one("hew.entity.rotate", { ids: [r.id], pivot: [0, 0, 0], axis: [1, 0, 0], angle: Math.PI / 2 });
      const after = await only(hew, "Side");
      await expectFrame(hew, after, X, [0, -1, 0], "Side on its edge");
    },
  },

  // ---------------------------------------------------------------- linked copies
  {
    id: "L1",
    title: "Linked copies turned 0/90/180/270°: each reports its own turned grain",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Leg", birch, [0.5, 0, 0], [0.6, 0.05, 0.018]);
      await links.rotateCopy(hew, [r.id], [0, 0, 0], [0, 0, 1], Math.PI / 2, 3);
      const rows = await rowsNamed(hew, "Leg");
      expect(rows.length === 4 && new Set(rows.map((x) => x.id)).size === 1, `expected 4 placements of one solid, got ${rows.length}`);
      const f0 = api.frameOf(rows[0]);
      expect(f0, "the first placement reports no frame");
      for (const b of rows) {
        const expected = carry(f0!.grain, rows[0], b);
        await expectFrame(hew, b, expected, carry(f0!.up, rows[0], b), `Leg ${loc(b).join("/")}`);
      }
      const grains = rows.map((b) => api.frameOf(b)!.grain);
      expect(grains.some((g) => sameLine(g, X)) && grains.some((g) => sameLine(g, Y)), "turned copies should give grain along both X and Y");
    },
  },
  {
    id: "L2",
    title: "A mirrored linked copy keeps the grain line and the top face",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Side", birch);
      await links.mirroredCopy(hew, r.id, [1, 0, 0], [1.3, 0, 0]);
      const rows = await rowsNamed(hew, "Side");
      expect(rows.length === 2 && new Set(rows.map((x) => x.id)).size === 1, "the mirrored copy should stay linked");
      const m = rows.find((x) => x.mirrored);
      expect(m, "one placement should read mirrored: true");
      await expectFrame(hew, m!, X, Z, "the mirrored Side");
    },
  },
  {
    id: "L3",
    title: "Changing the grain through one linked copy changes every copy",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Shelf", birch);
      await links.copy(hew, [r.id], [0, 0.5, 0], 2);
      const rows = await rowsNamed(hew, "Shelf");
      expect(rows.length === 3 && new Set(rows.map((x) => x.id)).size === 1, "expected 3 linked placements");
      await api.setFrame(hew, loc(rows[1]), { grain: Y, down: [0, 0, -1] });
      for (const b of await rowsNamed(hew, "Shelf")) await expectFrame(hew, b, Y, Z, `Shelf ${loc(b).join("/")}`);
      expect((await rowsNamed(hew, "Shelf")).length === 3 && new Set((await rowsNamed(hew, "Shelf")).map((x) => x.id)).size === 1,
        "changing the grain must not split the link");
    },
  },
  {
    id: "L4",
    title: "Make one copy unique, then change its grain: the others keep theirs",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Shelf", birch);
      await links.copy(hew, [r.id], [0, 0.5, 0], 2);
      const rows = await rowsNamed(hew, "Shelf");
      await links.unlink(hew, loc(rows[2]));
      const all = await rowsNamed(hew, "Shelf");
      const lone = all.find((x) => all.filter((y) => y.id === x.id).length === 1);
      expect(lone, "can't find the unlinked copy");
      await expectFrame(hew, lone!, X, Z, "the unlinked copy (it should keep the grain it had)");
      await api.setFrame(hew, loc(lone!), { grain: Y, down: [0, 0, -1] });
      for (const b of await rowsNamed(hew, "Shelf")) {
        const want = b.id === lone!.id ? Y : X;
        await expectFrame(hew, b, want, Z, `Shelf ${loc(b).join("/")}`);
      }
    },
  },
  {
    id: "L5",
    title: "Independent copy (Paste New): its own grain from the start",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Shelf", birch);
      await links.independentCopy(hew, [r.id], [0, 0.5, 0]);
      const rows = await rowsNamed(hew, "Shelf");
      expect(rows.length === 2 && new Set(rows.map((x) => x.id)).size === 2, "expected 2 independent solids");
      const copy = rows.find((x) => x.id !== r.id)!;
      await expectFrame(hew, copy, X, Z, "the independent copy (it should carry the grain over)");
      await api.setFrame(hew, loc(copy), { grain: Y, down: [0, 0, -1] });
      await expectFrame(hew, rows.find((x) => x.id === r.id)!, X, Z, "the original after changing the copy");
    },
  },
  {
    id: "L6",
    title: "Linked copies in birch and in maple share the top face and grain",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const maple = await api.createLayered(hew, "Maple ply 18", plywood(7, 18 * MM), true, [230, 210, 170]);
      const r = await plyPanel(hew, "Door", birch);
      await links.copy(hew, [r.id], [0, 0.5, 0]);
      const rows = await rowsNamed(hew, "Door");
      const inst = rows[1].path[rows[1].path.length - 1];
      expect(inst, "the copy should have an instance above its solid");
      await hew.one("hew.material.paint", { id: inst, material: maple });
      const after = await rowsNamed(hew, "Door");
      expect(new Set(after.map((x) => x.id)).size === 1, "painting one copy must not split the link");
      const mats = after.map((x) => x.material_effective ?? x.material);
      expect(mats.includes(birch) && mats.includes(maple), `expected one birch and one maple door, got ${JSON.stringify(mats)}`);
      for (const b of after) await expectFrame(hew, b, X, Z, `Door ${loc(b).join("/")}`);
    },
  },

  // ---------------------------------------------------------------- persistence
  {
    id: "S1",
    title: "Layers, top face and grain survive save and reopen (.hew)",
    needs: "layers",
    async run(hew) {
      const birch = await birch18(hew);
      const r = await plyPanel(hew, "Rail", birch, [0, 0, 0], [0.3, 0.5, 0.018]);
      await api.setFrame(hew, loc(r), { grain: X, down: [0, 0, -1] });
      const file = `${process.env.TCL_TMP ?? "/tmp"}/tcl-s1-${process.pid}.hew`;
      await hew.one("hew.doc.save", { path: file });
      const again = await Hew.start();
      try {
        await again.one("hew.doc.open", { path: file });
        const back = await only(again, "Rail");
        await expectFrame(again, back, X, Z, "Rail after reopening");
        const mat = back.material_effective ?? back.material;
        const m = await api.materialInfo(again, mat!);
        expect(m.layers.length === 9 && m.directional, `the material came back with ${m.layers.length} layers`);
        const pf = await api.partFrame(again, loc(back));
        expect(close(pf.extents[0], 0.3), `extents ${fmt(pf.extents)} after reopening, expected the grain length first`);
      } finally {
        again.close();
      }
    },
  },
];
