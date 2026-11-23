#!/usr/bin/env node
// tinycutlist: the cut list and cutting plans of a Hew model, from the command line.
// Reads only: a file opens in a private session and is never written back,
// and --live only queries the document open in the app.

import { existsSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { HewCliHost } from "./host/hew-cli.ts";
import { liveTitle } from "./live-title.ts";
import { KOFI } from "./support.ts";
import { countParts, type CutList } from "./cutlist/count.ts";
import { render, type Format } from "./cutlist/render.ts";
import { planCuts, totals, type CutPlan } from "./cutlist/nesting.ts";
import { addMissing, globalStockPath, loadStock } from "./stock-file.ts";
import { loadSolver } from "./solver.ts";

const USAGE = `tinycutlist — the cut list and cutting plans of a Hew model

USAGE
    tinycutlist <model.hew | model.skp> [options]
    tinycutlist --live [--document <ref>] [options]
    tinycutlist stock <model.hew | model.skp | --live> [--stock <file>]
    tinycutlist serve <model.hew | model.skp | --live> [--port 8790]   the window, in your browser

    A file opens in a private session and is never written back.
    --live reads the document open in the Hew app, without changing it.
    "stock" adds the model's materials that the stock file doesn't have yet,
    with sizes proposed from their names, for you to check and change.

OPTIONS
    -o, --output <file>   Write here instead of printing (.md, .csv, .json or .html)
    -f, --format <name>   md (default), csv, json or html; else from --output's extension
    --plan                Add the cutting plans to md and json (html always has them)
    --stock <file>        A project's stock file, over the global one
    --live                Read the document open in the Hew app
    --document <ref>      With --live: this open document (id, path, label or title)
    --sep <char>          CSV field separator (default ",")
    --decimal <char>      CSV decimal mark (default "."); for Italian spreadsheets: --sep ";" --decimal ","
    --hidden              Count hidden parts too
    --no-orient           Keep each part's own axis order instead of longest first
    -h, --help            Print this help

FILES
    ~/.config/tinycutlist/stock.json   The global stock file: material name → sheets or bars
                                       (TINYCUTLIST_CONFIG sets another folder)

ENVIRONMENT
    HEW_CLI               Path to hew-cli, if it isn't on the PATH (or in Hew.app on macOS)
    TINYCUTLIST_SOLVER    Folder holding packingsolver.js and .wasm (default: solver/dist)

TinyCutList is free and open source. If it saves you time, you can support it:
    ${KOFI.url}
`;

function fail(message: string, code = 1): never {
  process.stderr.write(`tinycutlist: ${message}\n`);
  process.exit(code);
}


const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

async function main() {
  if (process.argv[2] === "serve") {
    const { serve } = await import("./serve.ts");
    return serve(process.argv.slice(3)).catch((e) => fail(e.message));
  }
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        format: { type: "string", short: "f" },
        plan: { type: "boolean" },
        stock: { type: "string" },
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
  const { values: o } = parsed;
  let positionals = parsed.positionals;
  if (o.help) {
    process.stdout.write(USAGE);
    return;
  }
  const stockCommand = positionals[0] === "stock";
  if (stockCommand) positionals = positionals.slice(1);
  if (o.live ? positionals.length > 0 : positionals.length !== 1) fail(o.live ? "--live takes no model file" : `give one model file, or --live\n\n${USAGE}`, 2);
  if (o.document && !o.live) fail("--document needs --live", 2);

  const fromExt: Record<string, Format> = { ".md": "md", ".csv": "csv", ".json": "json", ".html": "html", ".htm": "html" };
  const format = (o.format ?? (o.output ? fromExt[extname(o.output).toLowerCase()] : undefined) ?? "md") as Format;
  if (!["md", "csv", "json", "html"].includes(format)) fail(`unknown format "${o.format}": use md, csv, json or html`, 2);
  const wantPlan = !stockCommand && (format === "html" || (!!o.plan && format !== "csv"));

  const file = positionals[0] ? resolve(positionals[0]) : null;
  if (file && !existsSync(file)) fail(`no such file: ${file}`);
  if (o.stock && !stockCommand && !existsSync(o.stock)) fail(`no such stock file: ${o.stock}`);
  // load the solver before Hew starts, so a missing solver fails fast
  const solver = wantPlan ? await loadSolver().catch((e) => fail(e.message)) : null;
  let stock = {};
  try {
    stock = loadStock([globalStockPath(), ...(o.stock && !stockCommand ? [o.stock] : [])]);
  } catch (e: any) {
    fail(`stock file: ${e.message}`);
  }

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

  if (stockCommand) {
    const path = o.stock ?? globalStockPath();
    const materials = [...new Map(res.parts.map((p) => [p.material ?? "", { name: p.material, type: p.materialType }])).values()];
    const added = addMissing(path, materials);
    process.stdout.write(
      added.length
        ? `Added ${n(added.length, "material", "materials")} to ${path}, with proposed sizes to check:\n${added.map((m) => `  ${m}`).join("\n")}\n`
        : `${path} already has every material of ${title}.\n`,
    );
    return;
  }

  let plan: CutPlan | null = null;
  if (solver) {
    try {
      plan = await planCuts(res, stock, solver);
    } catch (e: any) {
      fail(e.message);
    }
  }
  let text: string;
  try {
    text = render(format, title, res, plan, o.sep, o.decimal);
  } catch (e: any) {
    fail(e.message, 2);
  }
  if (o.output) writeFileSync(o.output, text);
  else process.stdout.write(text);

  const pieces = res.parts.reduce((s, p) => s + p.count, 0);
  const glued = res.glueUps.reduce((s, g) => s + g.count, 0);
  const sheets = plan ? plan.groups.filter((g) => g.kind === "sheet").reduce((s, g) => s + totals(g).stock, 0) : 0;
  const bars = plan ? plan.groups.filter((g) => g.kind === "bar").reduce((s, g) => s + totals(g).stock, 0) : 0;
  const guessed = plan ? plan.groups.filter((g) => g.stock.guessed).length : 0;
  const notes = [
    `${n(pieces, "part", "parts")} in ${n(res.parts.length, "row", "rows")}`,
    glued ? n(glued, "glue-up", "glue-ups") : "",
    res.open.length ? `${n(res.open.length, "object", "objects")} not closed (not measured)` : "",
    sheets ? n(sheets, "sheet", "sheets") : "",
    bars ? n(bars, "bar", "bars") : "",
    guessed ? `stock guessed for ${n(guessed, "group", "groups")} (run \`tinycutlist stock\`)` : "",
    `${((Date.now() - t0) / 1000).toFixed(1)} s`,
  ].filter(Boolean);
  process.stderr.write(`${title}: ${notes.join(", ")}${o.output ? ` → ${o.output}` : ""}\n`);
}

if (import.meta.main) await main();
