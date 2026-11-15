// A cut list as a Markdown table, for tools and tests. The plugin's own UI comes with M3.

import type { CutList } from "./count.ts";

const mm = (s: number[]) => s.join(" × ");

export function formatMarkdown(title: string, res: CutList): string {
  const out = [`# ${title}`, "", "| | Part | Qty | L | W | T | Material | Notes |", "|---|---|---:|---:|---:|---:|---|---|"];
  for (const p of res.parts) {
    const notes = [
      p.mirrored ? "mirrored" : "",
      p.otherNames.length ? `also named ${p.otherNames.join(", ")}` : "",
      p.glueUps.length ? `glued up in ${p.glueUps.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    out.push(`| ${p.label} | ${p.name} | ${p.count} | ${p.size[0]} | ${p.size[1]} | ${p.size[2]} | ${p.material ?? "—"} | ${notes} |`);
  }
  if (res.glueUps.length) {
    out.push(
      "",
      "## Glue-ups",
      "",
      "Each glue-up is cut as separate boards, listed above. Pick which boards go together, and how, so the grain matches before gluing.",
      "",
      "| | Glue-up | Qty | Blank | Boards |",
      "|---|---|---:|---|---|",
    );
    for (const g of res.glueUps) out.push(`| ${g.label} | ${g.name} | ${g.count} | ${mm(g.size)} | ${g.kind}: ${g.boards.join(" + ")} |`);
  }
  if (res.open.length) out.push("", "Not closed solids, not measured: " + res.open.map((o) => `${o.name ?? o.id} (${o.kind}) ×${o.count}`).join(", "));
  if (res.lookAlike.length) out.push("", "Look alike but not linked (Hew's \"link them?\" suggestion): " + res.lookAlike.map((g) => g.join(" = ")).join(", "));
  return out.join("\n");
}
