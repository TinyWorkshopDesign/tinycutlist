// Glue-ups: boards in contact that make one blank, found from their face frames
// (`hew.query.signature`'s `frame`: origin at the minimum corner, extents along
// x ≥ y ≥ z, so x runs along the length and z through the thickness).
//
// Two boards glue up when their lengths are parallel, about the same, and overlap almost fully,
// and they touch:
//   - face to face (laminated): across the thickness, widths about the same;
//   - edge to edge (an edge-glued panel): across the width, same thickness,
//     in one plane.
// A cleat under a shelf, a drawer resting on a shelf, a drawer bottom in its
// sides, or a rail against a stile don't match: widths or lengths differ, or
// the lengths aren't parallel.

export type Frame = { origin: number[]; x: number[]; y: number[]; z: number[]; extents: number[] };
export type Box = { frame: Frame };
export type Glue = {
  /** Indexes into the boxes, in order across the blank. */
  members: number[];
  kind: "laminated" | "edge-glued" | "mixed";
  /** The blank along the first board's axes, meters. */
  size: [number, number, number];
};

/** Contact tolerance, meters. */
const TOL = 0.0002;
/** Same thickness, and in one plane, for an edge joint. */
const FLUSH = 0.0005;
/** How much of the longer length, or of the narrower width, must overlap. */
const OVERLAP = 0.9;
/** How far laminated widths may differ, as a share of the wider one. */
const WIDTH = 0.1;

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const parallel = (a: number[], b: number[]) => Math.abs(dot(a, b)) > 1 - 1e-4;
const axes = (f: Frame) => [f.x, f.y, f.z];

export function center(f: Frame): number[] {
  const c = [...f.origin];
  axes(f).forEach((ax, i) => {
    for (let k = 0; k < 3; k++) c[k] += (ax[k] * f.extents[i]) / 2;
  });
  return c;
}

/** The board's size along an arbitrary direction (its axes are parallel to the frame's, or not). */
const extentAlong = (f: Frame, dir: number[]) => axes(f).reduce((s, ax, i) => s + Math.abs(dot(ax, dir)) * f.extents[i], 0);

const overlap = (d: number, ea: number, eb: number) => Math.min(ea, eb, (ea + eb) / 2 - Math.abs(d));

/** How two boards touch, or null. */
export function joint(a: Frame, b: Frame): "laminated" | "edge-glued" | null {
  if (!parallel(a.x, b.x)) return null;
  // b's width and thickness directions must line up with a's (any way round)
  if (!parallel(a.z, b.z) && !parallel(a.z, b.y)) return null;
  const ca = center(a), cb = center(b);
  const d = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];
  const [dx, dy, dz] = [dot(d, a.x), dot(d, a.y), dot(d, a.z)];
  const [al, aw, at] = a.extents;
  const [bl, bw, bt] = [extentAlong(b, a.x), extentAlong(b, a.y), extentAlong(b, a.z)];
  // nearly the same length, side by side: a short block resting on a long board isn't a blank
  if (overlap(dx, al, bl) < OVERLAP * Math.max(al, bl)) return null;
  // face to face, across a's thickness
  if (Math.abs(Math.abs(dz) - (at + bt) / 2) <= TOL && overlap(dy, aw, bw) >= OVERLAP * Math.min(aw, bw)) {
    if (Math.abs(aw - bw) <= WIDTH * Math.max(aw, bw)) return "laminated";
    return null;
  }
  // edge to edge, across a's width
  if (Math.abs(Math.abs(dy) - (aw + bw) / 2) <= TOL && Math.abs(at - bt) <= FLUSH && Math.abs(dz) <= FLUSH) return "edge-glued";
  return null;
}

export function findGlueUps(boxes: Box[]): Glue[] {
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const kinds = new Map<number, Set<"laminated" | "edge-glued">>();
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const k = joint(boxes[i].frame, boxes[j].frame);
      if (!k) continue;
      const ri = find(i), rj = find(j);
      const set = new Set([...(kinds.get(ri) ?? []), ...(kinds.get(rj) ?? []), k]);
      parent[ri] = rj;
      kinds.set(rj, set);
    }
  }
  const groups = new Map<number, number[]>();
  boxes.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  const out: Glue[] = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const ks = kinds.get(root)!;
    const kind = ks.size === 1 ? [...ks][0] : "mixed";
    const f0 = boxes[members[0]].frame;
    const c0 = center(f0);
    const along = (i: number, dir: number[]) => {
      const c = center(boxes[i].frame);
      return dot([c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]], dir);
    };
    // across the blank: through the thickness for a lamination, across the width for a panel
    const across = kind === "edge-glued" ? f0.y : f0.z;
    members.sort((i, j) => along(i, across) - along(j, across) || along(i, f0.y) - along(j, f0.y));
    const size = axes(f0).map((dir) => {
      let lo = Infinity, hi = -Infinity;
      for (const i of members) {
        const c = along(i, dir), h = extentAlong(boxes[i].frame, dir) / 2;
        lo = Math.min(lo, c - h);
        hi = Math.max(hi, c + h);
      }
      return hi - lo;
    }) as [number, number, number];
    out.push({ members, kind, size });
  }
  return out;
}
