// Synthetic models, each with the cut list the rule should give.
// `build` draws the model through a Host; `check` returns what's wrong (empty = right).
// Used live (test/hew/) and to record the fixtures the unit tests replay (tools/record-fixtures.ts).

import type { Host } from "../src/host/host.ts";
import { NS } from "../src/cutlist/materials.ts";
import type { CutList } from "../src/cutlist/count.ts";

export type Scene = { id: string; title: string; build: (host: Host) => Promise<void>; check: (res: CutList) => string[] };

const one = async (host: Host, method: string, params: Record<string, unknown>) => (await host.transact([{ method, params }]))[0];

/** A board of `size` meters [x, y, z], corner at `at`, as one transaction. */
async function board(host: Host, name: string, at: number[], size: number[], material?: string): Promise<string> {
  const [x, y, z] = at;
  const [dx, dy, dz] = size;
  const res = await host.transact([
    { method: "hew.sketch.draw_rect", as: "r", params: { plane: { origin: [0, 0, z], normal: [0, 0, 1] }, corner_a: [x, y, z], corner_b: [x + dx, y + dy, z] } },
    { method: "hew.solid.extrude", as: "o", params: { region: { $ref: "r#/region_id" }, distance: dz } },
    { method: "hew.entity.rename", params: { id: { $ref: "o#/object_id" }, name } },
    ...(material ? [{ method: "hew.material.set_default", params: { id: { $ref: "o#/object_id" }, material } }] : []),
  ]);
  return res[1].object_id;
}
const material = async (host: Host, name: string, color: number[], type: string) => {
  const m = (await one(host, "hew.material.create", { name, color })).material;
  await one(host, "hew.attr.set", { target: m, ns: NS, key: "type", value: type });
  return m as string;
};
const comp = async (host: Host, members: string[], name: string) => {
  const c = await one(host, "hew.component.create", { members });
  await one(host, "hew.entity.rename", { id: c.component, name });
  return c as { component: string; instance: string };
};
const copies = (host: Host, id: string, step: number[], count: number) =>
  one(host, "hew.entity.move", { ids: [id], translation: step, copy: { count } });
/** Cuts a box out of a world object (a transient box cutter only works by path); answers the new solid's id. */
const cut = async (host: Host, id: string, min: number[], max: number[]): Promise<string> => {
  const tool = await board(host, "cutter", min, max.map((v, i) => v - min[i]));
  return (await one(host, "hew.solid.subtract", { a: id, b: tool })).result;
};

const find = (res: CutList, name: string) => res.parts.filter((p) => p.name === name);
const want = (errors: string[], cond: boolean, msg: string) => {
  if (!cond) errors.push(msg);
};

export const SCENES: Scene[] = [
  {
    id: "S1",
    title: "Panel with dowels: every solid is a part, wherever it sits",
    async build(host) {
      const ply = await material(host, "Plywood 18", [220, 190, 150], "sheet_good");
      const beech = await material(host, "Beech", [210, 170, 120], "solid_wood");
      const panel = await board(host, "Panel", [0, 0, 0], [0.6, 0.4, 0.018], ply);
      const d = await board(host, "Dowel", [0.05, 0.05, 0.018], [0.008, 0.008, 0.03], beech);
      const dowel = await comp(host, [d], "Dowel");
      await copies(host, dowel.instance, [0.1, 0, 0], 3);
      const rows = (await host.query("hew.query.occurrences", {})).occurrences;
      const dowels = rows.filter((r: any) => r.kind === "instance" && r.definition === dowel.component).map((r: any) => r.id);
      await comp(host, [panel, ...dowels], "Panel assembly");
    },
    check(res) {
      const e: string[] = [];
      const p = find(res, "Panel");
      want(e, p.length === 1 && p[0].count === 1, `one Panel, got ${p.map((x) => x.count)}`);
      want(e, p[0]?.size.join() === "600,400,18", `Panel 600×400×18, got ${p[0]?.size}`);
      want(e, p[0]?.material === "Plywood 18", `Panel in Plywood 18, got ${p[0]?.material}`);
      const d = find(res, "Dowel");
      want(e, d.length === 1 && d[0].count === 4, `4 dowels as one row, got ${d.map((x) => x.count)}`);
      want(e, d[0]?.size.join() === "30,8,8", `dowel 30×8×8, got ${d[0]?.size}`);
      want(e, !find(res, "Panel assembly").length, "the assembly is not a part");
      want(e, res.parts.length === 2, `2 rows, got ${res.parts.length}`);
      want(e, res.glueUps.length === 0, `no glue-ups, got ${JSON.stringify(res.glueUps)}`);
      return e;
    },
  },
  {
    id: "S2",
    title: "Leg glued up from two boards, placed four times: two parts ×4 and one glue-up ×4",
    async build(host) {
      const oak = await material(host, "Oak", [180, 140, 90], "solid_wood");
      const a = await board(host, "Lamination A", [0, 0, 0], [0.05, 0.025, 0.7], oak);
      const b = await board(host, "Lamination B", [0, 0.025, 0], [0.05, 0.025, 0.7], oak);
      const leg = await comp(host, [a, b], "Leg");
      await copies(host, leg.instance, [0.5, 0, 0], 3);
    },
    check(res) {
      const e: string[] = [];
      for (const n of ["Lamination A", "Lamination B"]) {
        const l = find(res, n);
        want(e, l.length === 1 && l[0].count === 4, `${n} ×4 as one row, got ${l.map((x) => x.count)}`);
        want(e, l[0]?.size.join() === "700,50,25", `${n} 700×50×25, got ${l[0]?.size}`);
      }
      const g = res.glueUps;
      want(e, g.length === 1, `one kind of glue-up, got ${g.length}`);
      want(e, g[0]?.name === "Leg" && g[0]?.count === 4 && g[0]?.kind === "laminated", `Leg ×4 laminated, got ${JSON.stringify(g[0])}`);
      want(e, g[0]?.size.join() === "700,50,50", `blank 700×50×50, got ${g[0]?.size}`);
      const [la, lb] = [find(res, "Lamination A")[0]?.label, find(res, "Lamination B")[0]?.label];
      want(e, g[0]?.boards.slice().sort().join() === [la, lb].sort().join(), `boards ${la} + ${lb}, got ${g[0]?.boards}`);
      want(e, find(res, "Lamination A")[0]?.glueUps.join() === g[0]?.label, "Lamination A points at its glue-up");
      want(e, res.lookAlike.length === 0, `boards of one glue-up are not suggested for linking, got ${JSON.stringify(res.lookAlike)}`);
      return e;
    },
  },
  {
    id: "S3",
    title: "Left and right sides: a mirrored placement is a separate part only if the solid has a hand",
    async build(host) {
      // a cabinet side: a rabbet for the back and a dado for a shelf, both on the inner face
      let s = await board(host, "Side", [0, 0, 0], [0.018, 0.5, 0.7]);
      s = await cut(host, s, [0.009, 0.48, -0.01], [0.03, 0.51, 0.71]);
      s = await cut(host, s, [0.012, -0.01, 0.1], [0.03, 0.51, 0.118]);
      await one(host, "hew.entity.rename", { id: s, name: "Side" });
      const side = await comp(host, [s], "Side");
      const made = await copies(host, side.instance, [0.6, 0, 0], 1);
      await one(host, "hew.component.flip_instance", { instance: made.ids[0], axis: "x" });
      // a plain shelf: its own mirror image
      const shelf = await comp(host, [await board(host, "Shelf", [0, 0, 0.3], [0.56, 0.48, 0.018])], "Shelf");
      const madeS = await copies(host, shelf.instance, [3, 0, 0], 1);
      await one(host, "hew.component.flip_instance", { instance: madeS.ids[0], axis: "x" });
    },
    check(res) {
      const e: string[] = [];
      const s = find(res, "Side");
      want(e, s.length === 2 && s.every((p) => p.count === 1) && s.filter((p) => p.mirrored).length === 1, `Side: left and right as 2 rows, got ${s.map((x) => `${x.count}${x.mirrored ? "m" : ""}`)}`);
      const sh = find(res, "Shelf");
      want(e, sh.length === 1 && sh[0].count === 2 && !sh[0].mirrored, `Shelf (symmetric) ×2 as one row, got ${sh.map((x) => `${x.count}${x.mirrored ? "m" : ""}`)}`);
      return e;
    },
  },
  {
    id: "S4",
    title: "An edge band, a hidden shelf, a loose board and a door in a cabinet",
    async build(host) {
      const ply = await material(host, "Plywood 18", [220, 190, 150], "sheet_good");
      const band = await material(host, "Oak edge", [180, 140, 90], "edge");
      // a door, inside a cabinet component
      const door = await comp(host, [await board(host, "Door", [1, 0, 0], [0.7, 0.45, 0.018], ply)], "Door");
      await comp(host, [door.instance], "Cabinet");
      // a shelf hidden through a tag: left out
      const hidden = await comp(host, [await board(host, "Hidden shelf", [3, 0, 0], [0.5, 0.3, 0.018], ply)], "Hidden shelf");
      await one(host, "hew.tag.create", { path: ["Spare"] });
      await one(host, "hew.tag.assign", { id: hidden.instance, path: ["Spare"] });
      await one(host, "hew.tag.set_visible", { path: ["Spare"], visible: false });
      // a loose board, never copied, with no base material: its faces are plywood, one end is edge-banded
      const top = await board(host, "Loose top", [4, 0, 0], [0.8, 0.4, 0.025]);
      for (const at of [[4.4, 0.2, 0.025], [4.4, 0.2, 0], [4.4, 0, 0.0125], [4.4, 0.4, 0.0125], [4, 0.2, 0.0125]]) {
        await one(host, "hew.material.paint", { face: { object: top, at }, material: ply });
      }
      await one(host, "hew.material.paint", { face: { object: top, at: [4.8, 0.2, 0.0125] }, material: band });
    },
    check(res) {
      const e: string[] = [];
      const d = find(res, "Door");
      want(e, d.length === 1 && d[0].count === 1 && d[0].size.join() === "700,450,18", `Door ×1 700×450×18, got ${JSON.stringify(d.map((x) => [x.count, x.size]))}`);
      want(e, !find(res, "Cabinet").length, "Cabinet is not a part");
      want(e, !find(res, "Hidden shelf").length, "hidden shelf left out");
      const l = find(res, "Loose top");
      want(e, l.length === 1 && l[0].count === 1, "loose board listed once");
      want(e, l[0]?.material === "Plywood 18", `the edge band doesn't make the material, got ${l[0]?.material}`);
      want(e, res.parts.length === 2, `2 rows, got ${res.parts.map((p) => p.name)}`);
      return e;
    },
  },
  {
    id: "S5",
    title: "Groups only organise: the solids in them are parts",
    async build(host) {
      // a drawer box: the bottom sits in a group, and a pull component sits in another group
      const ply = await material(host, "Plywood 12", [220, 190, 150], "sheet_good");
      const front = await board(host, "Front", [0, 0, 0], [0.4, 0.012, 0.15], ply);
      const bottom = await board(host, "Bottom", [0, 0.012, 0], [0.4, 0.3, 0.012], ply);
      const g1 = (await one(host, "hew.group.create", { members: [bottom] })).group;
      const pull = await comp(host, [await board(host, "Pull", [0.18, -0.03, 0.06], [0.04, 0.03, 0.02])], "Pull");
      const g2 = (await one(host, "hew.group.create", { members: [pull.instance] })).group;
      const drawer = await comp(host, [front, g1, g2], "Drawer");
      await copies(host, drawer.instance, [0, 0, 0.2], 1);
    },
    check(res) {
      const e: string[] = [];
      for (const [n, size] of [["Front", "400,150,12"], ["Bottom", "400,300,12"], ["Pull", "40,30,20"]]) {
        const p = find(res, n);
        want(e, p.length === 1 && p[0].count === 2, `${n} ×2, got ${p.map((x) => x.count)}`);
        want(e, p[0]?.size.join() === size, `${n} ${size}, got ${p[0]?.size}`);
      }
      want(e, !find(res, "Drawer").length, "the drawer is not a part");
      want(e, res.glueUps.length === 0, `front, bottom and pull are joined, not glued up: got ${JSON.stringify(res.glueUps)}`);
      return e;
    },
  },
  {
    id: "S6",
    title: "Linked copies (M2 default): a board copied three times is one part ×4, even renamed",
    async build(host) {
      const oak = await material(host, "Oak", [180, 140, 90], "solid_wood");
      const shelf = await board(host, "Shelf", [0, 0, 0], [0.8, 0.25, 0.02], oak);
      await copies(host, shelf, [0, 0, 0.3], 3);
      const rows = (await host.query("hew.query.occurrences", {})).occurrences;
      const last = rows.filter((r: any) => r.kind === "instance").at(-1);
      await one(host, "hew.entity.rename", { id: last.id, name: "Top shelf" });
    },
    check(res) {
      const e: string[] = [];
      const s = find(res, "Shelf");
      want(e, s.length === 1 && s[0].count === 4, `Shelf ×4 as one row, got ${s.map((x) => x.count)}`);
      want(e, s[0]?.size.join() === "800,250,20", `Shelf 800×250×20, got ${s[0]?.size}`);
      want(e, s[0]?.otherNames.join() === "Top shelf", `the renamed copy shows as another name, got ${s[0]?.otherNames}`);
      want(e, res.parts.length === 1, `1 row, got ${res.parts.length}`);
      return e;
    },
  },
  {
    id: "S7",
    title: "Glue-ups: a lamination from a linked copy, an edge-glued top, and a cleat that isn't glued up",
    async build(host) {
      const oak = await material(host, "Oak", [180, 140, 90], "solid_wood");
      const ply = await material(host, "Plywood 18", [220, 190, 150], "sheet_good");
      // one board, copied on top of itself: the same part twice, glued face to face
      const lam = await board(host, "Lamina", [0, 0, 0], [0.7, 0.05, 0.025], oak);
      await copies(host, lam, [0, 0, 0.025], 1);
      // three boards of different widths, edge to edge
      await board(host, "Top board 1", [2, 0, 0], [0.9, 0.12, 0.02], oak);
      await board(host, "Top board 2", [2, 0.12, 0], [0.9, 0.15, 0.02], oak);
      await board(host, "Top board 3", [2, 0.27, 0], [0.9, 0.13, 0.02], oak);
      // a shelf resting on a cleat: in contact, but not a glue-up
      await board(host, "Cleat", [4, 0, 0], [0.5, 0.03, 0.02], oak);
      await board(host, "Shelf", [4, 0, 0.02], [0.5, 0.3, 0.018], ply);
    },
    check(res) {
      const e: string[] = [];
      const l = find(res, "Lamina");
      want(e, l.length === 1 && l[0].count === 2, `Lamina ×2 as one row, got ${l.map((x) => x.count)}`);
      const lg = res.glueUps.find((g) => g.kind === "laminated");
      want(e, lg?.boards.join() === `${l[0]?.label},${l[0]?.label}` && lg?.size.join() === "700,50,50", `lamination: ${l[0]?.label} + ${l[0]?.label}, 700×50×50, got ${JSON.stringify(lg)}`);
      const tg = res.glueUps.find((g) => g.kind === "edge-glued");
      const tops = [1, 2, 3].map((i) => find(res, `Top board ${i}`)[0]?.label);
      want(e, tg?.boards.join() === tops.join() || tg?.boards.join() === [...tops].reverse().join(), `top: ${tops.join(" + ")} in order, got ${tg?.boards}`);
      want(e, tg?.size.join() === "900,400,20", `top blank 900×400×20, got ${tg?.size}`);
      want(e, res.glueUps.length === 2, `2 glue-ups, got ${res.glueUps.length}`);
      want(e, !find(res, "Cleat")[0]?.glueUps.length && !find(res, "Shelf")[0]?.glueUps.length, "the cleat and the shelf aren't glued up");
      return e;
    },
  },
];
