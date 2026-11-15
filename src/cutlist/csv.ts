// A cut list as CSV, one row per part, for spreadsheets and other tools.
// Glue-ups are named in a column; their blanks are in the Markdown and JSON output.

import type { CutList } from "./count.ts";

export type CsvOptions = {
  /** Field separator. Default ",". Use ";" where the decimal mark is a comma. */
  sep?: string;
  /** Decimal mark. Default ".". */
  decimal?: string;
};

const HEADER = ["Label", "Part", "Quantity", "Length (mm)", "Width (mm)", "Thickness (mm)", "Material", "Mirrored", "Glue-ups", "Other names"];

export function formatCsv(res: CutList, opts: CsvOptions = {}): string {
  const { sep = ",", decimal = "." } = opts;
  if (sep === decimal) throw new Error(`the separator and the decimal mark can't both be "${sep}"`);
  const field = (v: string | number) => {
    const s = typeof v === "number" ? String(v).replace(".", decimal) : v;
    return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [HEADER];
  for (const p of res.parts) {
    const glue = p.glueUps.map((label) => {
      const g = res.glueUps.find((x) => x.label === label)!;
      return `${label} ${g.name} (${g.boards.join(" + ")})`;
    });
    rows.push([p.label, p.name, p.count, ...p.size, p.material ?? "", p.mirrored ? "yes" : "", glue.join("; "), p.otherNames.join("; ")] as any);
  }
  return rows.map((r) => r.map(field).join(sep)).join("\r\n") + "\r\n";
}
