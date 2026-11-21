// Part counting over Hew's `occurrences` (M2).
//
//   - A part is a closed solid: every Object Hew reports as `solid`, wherever
//     it sits (loose, in a group, or inside a component, at any depth).
//     Groups and components only organise.
//   - One row per solid: linked copies share their solid, so a board copied
//     three times is one row ×4. Rows split on material, size and handedness.
//   - Handedness comes from Hew's `signature`: a mirrored placement is a
//     separate row only if the solid isn't its own mirror image.
//   - Objects that aren't closed solids are reported, not measured.
//   - Solids that look identical but aren't linked (same `shape` hash) are
//     only suggested for linking.
//   - Boards glued face to face (laminated) or edge to edge (a panel) are
//     still separate parts, one per board, and are also listed as a glue-up,
//     so the grain of the boards can be matched before gluing.

import type { Host } from "../host/host.ts";
import { locator, locatorKey, type Occurrence } from "../model.ts";
import { TYPE_ORDER, VIRTUAL, readMaterials, type MaterialType } from "./materials.ts";
import { findGlueUps, type Box, type Frame } from "./glue.ts";

export type CountOptions = {
  includeHidden?: boolean;
  /** Longest extent first. Default true. */
  autoOrient?: boolean;
  /** Material name → type, for materials the model doesn't type. */
  types?: Record<string, MaterialType>;
};

export type Part = {
  label: string;
  name: string;
  /** The solid every placement of this row shares. */
  object: string;
  material: string | null;
  materialType: MaterialType;
  /**
   * Millimeters, rounded to 0.1. Longest first, unless the part has `grain`:
   * then length along the grain, width, thickness, as Hew gives them.
   */
  size: [number, number, number];
  /**
   * The grain comes from the part's material in Hew (a layered material with a
   * grain direction): `size[0]` runs along it, even when it isn't the longest,
   * and the nesting keeps it along the sheet's grain.
   */
  grain?: boolean;
  /** A left or right hand of a part that isn't its own mirror image. */
  mirrored: boolean;
  count: number;
  placements: string[][];
  /** Names the placements carry besides the part's own (renamed linked copies). */
  otherNames: string[];
  /** Labels of the glue-ups this part goes into. */
  glueUps: string[];
};

export type GlueUp = {
  label: string;
  /** The component or group holding the boards, if they share one. */
  name: string;
  kind: "laminated" | "edge-glued" | "mixed";
  /** How many identical glue-ups the model holds. */
  count: number;
  /** One part label per board, in order across the blank. */
  boards: string[];
  /** The blank's size in millimeters, rounded to 0.1. */
  size: [number, number, number];
  placements: string[][][];
};

export type CutList = {
  parts: Part[];
  glueUps: GlueUp[];
  open: { name: string | null; id: string; kind: "open" | "split"; count: number }[];
  /** Rows of different solids with the same shape and material: candidates for Hew's "link them?". */
  lookAlike: string[][];
};

const r1 = (v: number) => Math.round(v * 10) / 10;

export function letters(n: number): string {
  let s = "";
  n += 1;
  while (n) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

type Placement = { row: Occurrence; loc: string[]; part: Part; frame: Frame };

export async function countParts(host: Host, opts: CountOptions = {}): Promise<CutList> {
  const { includeHidden = false, autoOrient = true } = opts;
  const rows: Occurrence[] = (await host.query("hew.query.occurrences", { include_hidden: includeHidden })).occurrences;
  const materials = await readMaterials(host, opts.types);
  const byLoc = new Map<string, Occurrence>(rows.map((r) => [locatorKey(locator(r)), r]));

  // Hew's own rule, as the user sees it: the solid's base material, else its faces' effective
  // materials (painted faces, then the nearest painted placement), edges and veneers left out
  async function partMaterial(o: Occurrence, loc: string[]): Promise<string | null> {
    if (o.material && !VIRTUAL.has(materials.type(o.material))) return o.material;
    const votes = new Map<string, number>();
    for (const f of (await host.query("hew.query.faces", { path: loc })).faces) {
      const m = f.material_effective ?? f.material ?? null;
      if (m && !VIRTUAL.has(materials.type(m))) votes.set(m, (votes.get(m) ?? 0) + 1);
    }
    const best = [...votes].sort(
      (a, b) => b[1] - a[1] || TYPE_ORDER.indexOf(materials.type(a[0])) - TYPE_ORDER.indexOf(materials.type(b[0])),
    )[0];
    return best ? best[0] : o.material_effective;
  }

  /** Millimeters; longest first with autoOrient, unless `keepOrder` (Hew gave the grain's order). */
  const oriented = (extentsM: number[], keepOrder = false): [number, number, number] => {
    let size = extentsM.map((v) => v * 1000);
    if (autoOrient && !keepOrder) size = [...size].sort((a, b) => b - a);
    return size.map(r1) as [number, number, number];
  };

  const parts = new Map<string, Part>();
  const open = new Map<string, { name: string | null; id: string; kind: "open" | "split"; count: number }>();
  const shapes = new Map<string, string>(); // part key → shape hash
  const placements: Placement[] = [];

  for (const o of rows) {
    if (o.kind !== "object") continue;
    if (o.solid === undefined) throw new Error(`row ${o.id} has no \`solid\` field: this needs Hew M2 or later`);
    const holder = o.path.length ? byLoc.get(locatorKey(o.path)) : undefined;
    const name = o.name || holder?.definition_name || "Part";
    if (!o.solid) {
      const e = open.get(o.id) ?? { name, id: o.id, kind: o.family != null ? "split" as const : "open" as const, count: 0 };
      e.count++;
      open.set(o.id, e);
      continue;
    }
    const loc = locator(o);
    const sig = await host.query("hew.query.signature", { path: loc });
    // part_frame honours a frame the user set on the solid (grain direction); the signature's doesn't
    const pf = await host.query("hew.query.part_frame", { path: loc });
    // a layered material with a grain (hew#134): extents come length along the grain first
    const grain = pf.source === "material";
    const size = oriented(pf.extents, grain);
    const material = await partMaterial(o, loc);
    const mirrored = o.mirrored && !sig.symmetric;
    const k = JSON.stringify([o.id, material, size, mirrored, grain]);
    let p = parts.get(k);
    if (!p) {
      p = {
        label: "", name, object: o.id, material: materials.name(material), materialType: materials.type(material),
        size, ...(grain ? { grain } : {}), mirrored, count: 0, placements: [], otherNames: [], glueUps: [],
      };
      parts.set(k, p);
      shapes.set(k, `${sig.shape}/${material}`);
    }
    p.count++;
    p.placements.push(loc);
    // a linked copy can be renamed on its own: the name sits on its placement
    const own = holder?.name;
    if (own && own !== p.name && !p.otherNames.includes(own)) p.otherNames.push(own);
    placements.push({ row: o, loc, part: p, frame: sig.frame });
  }

  const list = [...parts.values()].sort(
    (a, b) => (a.material ?? "~").localeCompare(b.material ?? "~") || b.size[2] - a.size[2] || b.size[0] - a.size[0] || b.size[1] - a.size[1] || a.name.localeCompare(b.name),
  );
  list.forEach((p, i) => (p.label = letters(i)));

  // look-alikes: the same shape and material, but different solids
  const alike = new Map<string, string[]>();
  for (const [k, p] of parts) {
    const s = shapes.get(k)!;
    alike.set(s, [...(alike.get(s) ?? []), p.label]);
  }

  // glue-ups: boards in contact, grouped into identical blanks
  const boxes: Box[] = placements.map((pl) => ({ frame: pl.frame }));
  const blanks = new Map<string, GlueUp>();
  for (const g of findGlueUps(boxes)) {
    let members = g.members.map((i) => placements[i]);
    // read from either face: a blank and its mirror image list their boards the same way
    const across = members.map((m) => m.part.label);
    if ([...across].reverse().join() < across.join()) members = members.reverse();
    const boards = members.map((m) => m.part.label);
    const locs = members.map((m) => m.loc);
    // named after the deepest component or group all the boards share
    let prefix = locs[0].slice(0, -1);
    for (const l of locs) {
      let n = 0;
      while (n < prefix.length && n < l.length - 1 && prefix[n] === l[n]) n++;
      prefix = prefix.slice(0, n);
    }
    const parents = new Set(members.map((m) => m.row.parent));
    const holder = prefix.length ? byLoc.get(locatorKey(prefix)) : undefined;
    const group = parents.size === 1 && members[0].row.parent ? byLoc.get(locatorKey([...members[0].row.path, members[0].row.parent])) : undefined;
    const name = group?.name || holder?.definition_name || "Glue-up";
    const size = oriented(g.size);
    const key = JSON.stringify([name, g.kind, boards, size]);
    const b = blanks.get(key) ?? { label: "", name, kind: g.kind, count: 0, boards, size, placements: [] };
    b.count++;
    b.placements.push(locs);
    blanks.set(key, b);
  }
  const glueUps = [...blanks.values()].sort((a, b) => a.name.localeCompare(b.name) || b.size[0] - a.size[0]);
  glueUps.forEach((g, i) => {
    g.label = `G${i + 1}`;
    for (const l of new Set(g.boards)) list.find((p) => p.label === l)!.glueUps.push(g.label);
  });

  // boards of one glue-up are meant to be separate boards: never suggest linking them
  const lookAlike = [...alike.values()]
    .filter((g) => g.length > 1 && !glueUps.some((gu) => g.every((l) => gu.boards.includes(l))))
    .map((g) => g.sort());

  return { parts: list, glueUps, open: [...open.values()], lookAlike };
}
