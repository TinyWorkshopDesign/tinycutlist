// One cut list, in the format asked for: Markdown, CSV, JSON or the printable
// HTML page. Shared by the command line and the plugin inside Hew.

import type { CutList } from "./count.ts";
import { formatCsv } from "./csv.ts";
import { formatMarkdown, formatPlanMarkdown } from "./format.ts";
import { formatHtml } from "./html.ts";
import type { CutPlan } from "./nesting.ts";

export type Format = "md" | "csv" | "json" | "html";

export function render(format: Format, title: string, res: CutList, plan: CutPlan | null, sep?: string, decimal?: string): string {
  if (format === "csv") return formatCsv(res, { sep, decimal });
  if (format === "json") return JSON.stringify(plan ? { ...res, plan } : res, null, 2) + "\n";
  if (format === "html") return formatHtml(title, res, plan!);
  return formatMarkdown(title, res) + (plan ? "\n\n" + formatPlanMarkdown(plan) : "") + "\n";
}
