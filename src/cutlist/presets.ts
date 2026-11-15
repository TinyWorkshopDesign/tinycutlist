// Common sheet goods and their standard commercial sizes (length × width, mm),
// as a woodworking supplier normally stocks them. Full sheets only: strips and
// cut-to-size pieces are left out. A material whose name matches a preset
// starts from it; the user can always change the sizes in the stock file.
//
// `match` is tried on the material's name, in Italian and English, in order:
// the first preset that matches wins, so the more specific ones come first.

export type Preset = {
  id: string;
  name: string;
  match: RegExp;
  sheets: [number, number][];
  /** The face has a grain the parts should follow. */
  grain: boolean;
};

export const PRESETS: Preset[] = [
  { id: "plywood-phenolic", name: "Film-faced (phenolic) plywood", match: /fenolic\w*.*(film|antisciv|cassero)|carply|wire mesh|film.?faced|antisciv/i, sheets: [[2500, 1250]], grain: false },
  { id: "plywood-faced", name: "Faced plywood (laminate or veneer)", match: /multistrat\w*.*(bilaminat|placcat|nobilitat|laminat|impiallacc)|(bilaminat|placcat)\w*.*multistrat/i, sheets: [[3050, 1300], [2440, 1220]], grain: true },
  { id: "plywood-birch", name: "Birch plywood", match: /betulla|birch|baltic/i, sheets: [[2500, 1250], [1525, 1525]], grain: true },
  { id: "plywood-okoume", name: "Okoume marine plywood", match: /okoum/i, sheets: [[3100, 1530], [2500, 1220]], grain: true },
  { id: "plywood-pine", name: "Pine or fir plywood", match: /multistrat\w*.*(pino|abete|elliott?is)|(pine|fir|spruce).*ply|pino cileno/i, sheets: [[2500, 1250], [2440, 1220]], grain: false },
  { id: "plywood-poplar", name: "Poplar plywood", match: /pioppo|poplar|multistrat|plywood|multiplex|contreplaqu/i, sheets: [[2520, 1870], [2500, 1250], [2440, 1220]], grain: false },
  { id: "thin-plywood", name: "Thin decorative plywood (3–6 mm)", match: /compensat|thin ply|veneer ply/i, sheets: [[2520, 1250], [3000, 1250]], grain: true },
  { id: "hdf", name: "HDF / hardboard", match: /\bhdf\b|masonite|faesite|hardboard/i, sheets: [[2800, 2070]], grain: false },
  { id: "mdf", name: "MDF", match: /\bmdf\b|medium.?density/i, sheets: [[2800, 2070], [3660, 2200]], grain: false },
  { id: "chipboard-melamine", name: "Melamine-faced chipboard", match: /nobilitat|melamin|melaminic|laminat\w* truciol|faced chipboard/i, sheets: [[2800, 2070], [3050, 2070]], grain: false },
  { id: "chipboard", name: "Chipboard / particleboard", match: /truciol|chipboard|particle ?board/i, sheets: [[2800, 2070], [3770, 2070]], grain: false },
  { id: "osb", name: "OSB", match: /\bosb\b/i, sheets: [[2500, 1250]], grain: false },
  { id: "blockboard", name: "Blockboard", match: /listellar|listellat|blockboard/i, sheets: [[3120, 1850], [3660, 1870]], grain: true },
  { id: "panel-3-layer", name: "3-layer solid wood panel", match: /(3|tre) strati|3.?layer|three.?layer|tristrato/i, sheets: [[5050, 2050], [3000, 1250]], grain: true },
  { id: "panel-spruce", name: "Glued spruce or fir panel", match: /lamellar\w*.*(abete|pino|larice)|(abete|spruce|fir|pine).*(lamellar|glued|panel)/i, sheets: [[2450, 1200], [3000, 1250]], grain: true },
  { id: "panel-hardwood", name: "Glued hardwood panel (beech, oak…)", match: /lamellar|glued panel|edge.?glued|leimholz/i, sheets: [[3000, 1200], [4500, 1220]], grain: true },
];

export function presetFor(name: string | null): Preset | null {
  if (!name) return null;
  return PRESETS.find((p) => p.match.test(name)) ?? null;
}
