// Every call or field for layered materials whose bus shape isn't public yet
// lives here, so the cases don't change when the names are settled
// (hew3d/hew#134). Kurt's app design gives the wasm names
// (add_layered_material, object_material_frame, set_material_frame_from_face,
// set_material_frame, material_thickness_mismatch); the bus names below are
// guesses built from them, marked TBD.
//
// Only these TBD calls can turn a case into SKIP ("API not settled"): when
// Hew rejects a call's shape, or when none of the candidate field names is
// on a row. Never because the behaviour is wrong. Any other error stays an
// ERROR.

import type { Hew, Row } from "../linked-copies/hew.ts";
import { ApiNotSettled } from "../linked-copies/adapter.ts";

export { ApiNotSettled };

export type Vec = [number, number, number];

/** A layer as the bus is expected to take it: metres, like every length on the bus. */
export type Layer = { thickness: number; color: [number, number, number, number]; name?: string };

const SHAPE = /invalid_params|unknown field|unknown variant|missing field|locator needs|expected a string|invalid type|unknown method|unknown_command|-32602|-32601/i;

async function tbd<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e: any) {
    const text = `${e?.refusal ?? ""} ${e?.message ?? ""}`;
    if (SHAPE.test(text)) throw new ApiNotSettled(text.trim());
    throw e;
  }
}

/** The first of `names` present on `obj`; SKIP if none is (the field isn't named yet). */
function field<T>(obj: any, names: string[], what: string): T {
  for (const n of names) if (obj && obj[n] !== undefined) return obj[n];
  throw new ApiNotSettled(`no field for ${what} (tried ${names.join(", ")})`);
}

/** Same, but `undefined` when none is present (for fields that may rightly be absent). */
function maybe<T>(obj: any, names: string[]): T | undefined {
  for (const n of names) if (obj && obj[n] !== undefined && obj[n] !== null) return obj[n];
  return undefined;
}

/** World point → the leaf's own frame, as linked-copies/adapter.ts does for locators by path. */
async function toLeafFrame(hew: Hew, path: string[], at: number[]): Promise<number[]> {
  const rows = await hew.occurrences();
  const row = rows.find((r) => r.id === path[path.length - 1] && JSON.stringify(r.path) === JSON.stringify(path.slice(0, -1)));
  if (!row) return at;
  const m = row.world_pose;
  const d = [at[0] - m[3], at[1] - m[7], at[2] - m[11]];
  const col = (j: number) => [m[j], m[4 + j], m[8 + j]];
  return [0, 1, 2].map((j) => {
    const c = col(j);
    const len2 = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
    return (c[0] * d[0] + c[1] * d[1] + c[2] * d[2]) / len2;
  });
}

// ---------------------------------------------------------------- writes

/** TBD: a layered material. Assumed: `hew.material.create` grows `layers` and `directional`. */
export const createLayered = (hew: Hew, name: string, layers: Layer[], directional: boolean, color: [number, number, number] = [200, 170, 120]) =>
  tbd(async () => (await hew.one("hew.material.create", { name, color, layers, directional })).material as string);

/** TBD: replace a material's layers (one undo entry). */
export const setLayers = (hew: Hew, material: string, layers: Layer[]) =>
  tbd(() => hew.one("hew.material.set_layers", { material, layers }));

/**
 * TBD: Paint's plain click with a layered material, on one placement: the part
 * becomes that material and the face at `at` (world point) becomes the top,
 * grain along its longest edge.
 */
export const applyFromFace = (hew: Hew, path: string[], at: Vec, material: string) =>
  tbd(async () => hew.one("hew.material.apply_layered", { face: { path, at: await toLeafFrame(hew, path, at) }, material }));

/** TBD: set the frame outright ("Grain runs along", "Flip"), directions in world space. */
export const setFrame = (hew: Hew, path: string[], frame: { grain: Vec; down: Vec }) =>
  tbd(() => hew.one("hew.material.set_frame", { path, ...frame }));

// ---------------------------------------------------------------- reads

/** A material's layer info, from the scene's material list. */
export async function materialInfo(hew: Hew, id: string) {
  const scene = await hew.query("hew.query.scene", {});
  const m = (scene.materials ?? []).find((x: any) => x.id === id);
  if (!m) throw new Error(`material ${id} not in hew.query.scene`);
  return {
    kind: field<string>(m, ["kind", "material_kind"], "material kind"),
    layers: maybe<Layer[]>(m, ["layers"]) ?? [],
    thickness: maybe<number>(m, ["thickness", "total_thickness"]),
    directional: field<boolean>(m, ["directional", "has_grain", "grain"], "material directional"),
  };
}

/**
 * A placement's material frame in world space: `grain` (a line) and `up`
 * (the top face's outward normal), or null when the part has none. Kurt's
 * wasm call gives "the direction down through the layers"; either form is
 * accepted and turned into `up`.
 */
export function frameOf(row: Row): { grain: Vec; up: Vec } | null {
  const f = maybe<any>(row, ["material_frame", "frame"]) ?? row;
  const grain = maybe<Vec>(f, ["grain", "grain_direction", "grain_world"]);
  const up = maybe<Vec>(f, ["top", "top_normal", "up"]);
  const down = maybe<Vec>(f, ["down", "down_direction"]);
  if (!grain && !up && !down) {
    if ("material_frame" in row || "grain" in row) return null; // field known, no frame
    throw new ApiNotSettled("no field for the material frame on occurrences (tried material_frame, grain, top, down)");
  }
  return { grain: grain ?? [0, 0, 0], up: up ?? (down ? [-down[0], -down[1], -down[2]] : [0, 0, 0]) };
}

/** A thickness mismatch on a placement, in metres, or null when part and material agree. */
export function mismatchOf(row: Row): { part: number; material: number } | null {
  const m = maybe<any>(row, ["thickness_mismatch", "material_thickness_mismatch"]);
  if (m === undefined) {
    if ("thickness_mismatch" in row) return null;
    throw new ApiNotSettled("no field for thickness_mismatch on occurrences");
  }
  return { part: field<number>(m, ["part", "part_thickness"], "mismatch.part"), material: field<number>(m, ["material", "material_thickness"], "mismatch.material") };
}

/** `hew.query.part_frame` for one placement: `source` and extents, metres. */
export async function partFrame(hew: Hew, path: string[]) {
  const f = await hew.query("hew.query.part_frame", { path });
  return {
    source: (f.source ?? null) as string | null,
    extents: (f.extents ?? f.size ?? []) as number[],
  };
}
