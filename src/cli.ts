#!/usr/bin/env node
// tinycutlist: the cut list of a Hew model, from the command line.
// Reads only: a file opens in a private session and is never written back,
// and --live only queries the document open in the app.

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { HewCliHost, hewCliPath } from "./host/hew-cli.ts";
import { countParts, type CutList } from "./cutlist/count.ts";
import { formatCsv } from "./cutlist/csv.ts";
import { formatMarkdown } from "./cutlist/format.ts";

const USAGE = `tinycutlist — the cut list of a Hew model

USAGE
    tinycutlist <model.hew | model.skp> [options]
    tinycutlist --live [--document <ref>] [options]

    A file opens in a private session and is never written back.
    --live reads the document open in the Hew app, without changing it.

OPTIONS
    -o, --output <file>   Write here instead of printing (.md, .csv or .json)
    -f, --format <name>   md (default), csv or json; else from --output's extension
    --live                Read the document open in the Hew app
    --document <ref>      With --live: this open document (id, path, label or title)
    --sep <char>          CSV field separator (default ",")
    --decimal <char>      CSV decimal mark (default "."); for Italian spreadsheets: --sep ";" --decimal ","
    --hidden              Count hidden parts too
    --no-orient           Keep each part's own axis order instead of longest first
    -h, --help            Print this help

ENVIRONMENT
    HEW_CLI               Path to hew-cli, if it isn't on the PATH (or in Hew.app on macOS)
`;

type Format = "md" | "csv" | "json";

function fail(message: string, code = 1): never {
  process.stderr.write(`tinycutlist: ${message}\n`);
  process.exit(code);
}

export function render(format: Format, title: string, res: CutList, sep?: string, decimal?: string): string {
  if (format === "csv") return formatCsv(res, { sep, decimal });
  if (format === "json") return JSON.stringify(res, null, 2) + "\n";
  return formatMarkdown(title, res) + "\n";
}

/** The live document's title, as `hew-cli documents --live` lists it (front window unless `ref` names one). */
function liveTitle(ref?: string): string | null {
  try {
    const docs = execFileSync(hewCliPath(), ["documents", "--live"], { encoding: "utf8", timeout: 10000 })
      .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const d = docs.find((x: any) => (ref ? [x.id, x.path, x.title].includes(ref) : x.front));
    return d?.title ?? null;
  } catch {
    return null;
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        format: { type: "string", short: "f" },
        live: { type: "boolean" },
        document: { type: "string" },
        sep: { type: "string" },
        decimal: { type: "string" },
        hidden: { type: "boolean" },
        "no-orient": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e: any) {
    fail(`${e.message}\n\n${USAGE}`, 2);
  }
  const { values: o, positionals } = parsed;
  if (o.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (o.live ? positionals.length > 0 : positionals.length !== 1) fail(o.live ? "--live takes no model file" : `give one model file, or --live\n\n${USAGE}`, 2);
  if (o.document && !o.live) fail("--document needs --live", 2);

  const fromExt: Record<string, Format> = { ".md": "md", ".csv": "csv", ".json": "json" };
  const format = (o.format ?? (o.output ? fromExt[extname(o.output).toLowerCase()] : undefined) ?? "md") as Format;
  if (!["md", "csv", "json"].includes(format)) fail(`unknown format "${o.format}": use md, csv or json`, 2);

  const file = positionals[0] ? resolve(positionals[0]) : null;
  if (file && !existsSync(file)) fail(`no such file: ${file}`);

  const t0 = Date.now();
  let host: HewCliHost | undefined;
  let res: CutList;
  try {
    host = await HewCliHost.start(undefined, o.live ? ["--live", ...(o.document ? ["--document", o.document] : [])] : []);
    if (file) await host.open(file);
    res = await countParts(host, { includeHidden: o.hidden ?? false, autoOrient: !o["no-orient"] });
  } catch (e: any) {
    fail(e.message);
  } finally {
    host?.close();
  }

  const title = file ? basename(file) : liveTitle(o.document) ?? "Hew: open document";
  let text: string;
  try {
    text = render(format, title, res, o.sep, o.decimal);
  } catch (e: any) {
    fail(e.message, 2);
  }
  if (o.output) writeFileSync(o.output, text);
  else process.stdout.write(text);

  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const pieces = res.parts.reduce((s, p) => s + p.count, 0);
  const glued = res.glueUps.reduce((s, g) => s + g.count, 0);
  const notes = [
    `${n(pieces, "part", "parts")} in ${n(res.parts.length, "row", "rows")}`,
    glued ? n(glued, "glue-up", "glue-ups") : "",
    res.open.length ? `${n(res.open.length, "object", "objects")} not closed (not measured)` : "",
    `${((Date.now() - t0) / 1000).toFixed(1)} s`,
  ].filter(Boolean);
  process.stderr.write(`${title}: ${notes.join(", ")}${o.output ? ` → ${o.output}` : ""}\n`);
}

if (import.meta.main) await main();
