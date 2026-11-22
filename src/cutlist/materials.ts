// Material types, after OpenCutList's. The type is our attribute on the material
// (namespace `io.github.tinyworkshopdesign.tinycutlist`, key `type`), else an optional name → type map.

import type { Host } from "../host/host.ts";

export const NS = "io.github.tinyworkshopdesign.tinycutlist";

export type MaterialType =
  | "solid_wood" | "sheet_good" | "dimensional" | "edge" | "veneer" | "unknown";

const KNOWN = new Set<string>(["solid_wood", "sheet_good", "dimensional", "edge", "veneer"]);

/** OpenCutList's order, used to break ties when a part's faces vote for its material. */
export const TYPE_ORDER: MaterialType[] = [
  "solid_wood", "sheet_good", "dimensional", "edge", "veneer", "unknown",
];

/** Materials that dress a part (edges, veneers) and never make one. */
export const VIRTUAL = new Set<MaterialType>(["edge", "veneer"]);

export type Materials = {
  name(id: string | null): string | null;
  type(id: string | null): MaterialType;
};

export async function readMaterials(host: Host, typesByName: Record<string, MaterialType> = {}, generation?: number): Promise<Materials> {
  const scene = await host.query("hew.query.scene", {});
  const names = new Map<string, string>((scene.materials ?? []).map((m: any) => [m.id, m.name]));
  const ids = [...names.keys()];
  // every material's dictionary in one read; a material with none is refused in its own slot
  const answers = await host.read(ids.map((id) => ({ method: "hew.attr.get", params: { target: id, ns: NS } })), generation);
  const types = new Map<string, MaterialType>();
  ids.forEach((id, i) => {
    let t: MaterialType | undefined = typesByName[names.get(id)!];
    const a = answers[i].ok ? answers[i].result : null;
    const v = a?.dictionaries?.[NS]?.type ?? a?.[NS]?.type ?? a?.type;
    if (typeof v === "string") t = KNOWN.has(v) ? (v as MaterialType) : "unknown";
    types.set(id, t ?? "unknown");
  });
  return {
    name: (id) => (id ? names.get(id) ?? id : null),
    type: (id) => (id ? types.get(id) ?? "unknown" : "unknown"),
  };
}
