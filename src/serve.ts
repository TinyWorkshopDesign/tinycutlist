// tinycutlist serve: the window, in a browser, until Hew can host it (M3).
//
// It answers the window's commands (src/ui/protocol.ts) over HTTP, on
// 127.0.0.1 only, from one hew-cli session: a model file opened privately, or
// the document open in Hew (--live, read-only except for "show in Hew", which
// selects and frames). The stock is the command line's: the global stock file,
// or a project's own with --stock.
//
//   node src/serve.ts <model.hew | model.skp> | --live [--document <ref>] [--port 8790] [--stock <file>]

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { HewCliHost } from "./host/hew-cli.ts";
import { countParts, type CutList } from "./cutlist/count.ts";
import { planCuts, totals } from "./cutlist/nesting.ts";
import { render } from "./cutlist/render.ts";
import type { Stock } from "./cutlist/stock.ts";
import { globalStockPath, loadStock, readStock } from "./stock-file.ts";
import { loadSolver } from "./solver.ts";
import { liveTitle } from "./live-title.ts";
import type { Command, Commands, ExportFormat, Info, Summary } from "./ui/protocol.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;

export const SERVE_USAGE = `tinycutlist serve — the TinyCutList window, in your browser

USAGE
    tinycutlist serve <model.hew | model.skp> [--port 8790] [--stock <file>]
    tinycutlist serve --live [--document <ref>] [--port 8790] [--stock <file>]

    Opens on http://127.0.0.1:<port>, for this computer only. A file opens in a
    private session and is never written back. --live reads the document open in
    Hew, and changes nothing in it: "Show in Hew" only selects and frames.
    Stock changes go to the global stock file, or to --stock's file.
`;

type Handlers = { [C in Command]: (params: Commands[C]["params"]) => Promise<Commands[C]["result"]> };

export async function serve(argv: string[]): Promise<void> {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      live: { type: "boolean" },
      document: { type: "string" },
      port: { type: "string" },
      stock: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (o.help) {
    process.stdout.write(SERVE_USAGE);
    return;
  }
  if (o.live ? positionals.length > 0 : positionals.length !== 1) throw new Error(o.live ? "--live takes no model file" : `give one model file, or --live\n\n${SERVE_USAGE}`);
  const file = positionals[0] ? resolve(positionals[0]) : null;
  if (file && !existsSync(file)) throw new Error(`no such file: ${file}`);
  const port = Number(o.port ?? 8790);
  const stockPath = o.stock ? resolve(o.stock) : globalStockPath();
  const stockPaths = o.stock ? [globalStockPath(), stockPath] : [globalStockPath()];

  // one hew-cli session, started on first use and again if it went away (Hew restarted)
  let host: HewCliHost | null = null;
  const hostArgs = o.live ? ["--live", ...(o.document ? ["--document", o.document] : [])] : [];
  async function withHost<T>(f: (h: HewCliHost) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (!host) {
        host = await HewCliHost.start(undefined, hostArgs);
        if (file) await host.open(file);
      }
      try {
        return await f(host);
      } catch (e: any) {
        if (attempt > 0 || e?.refusal) throw e;
        host.close();
        host = null; // the session died: start a new one and try once more
      }
    }
  }

  const solver = loadSolver();
  let cutList: CutList | null = null;
  const title = () => (file ? basename(file) : (liveTitle(o.document) ?? "Hew: open document").replace(/ — Hew( · Preview)?$/, ""));

  const handlers: Handlers = {
    info: async (): Promise<Info> => ({
      title: title(),
      live: !!o.live,
      canShow: !!o.live,
      stockWhere: stockPath.replace(homedir(), "~"),
      version,
    }),
    cut_list: async ({ refresh }) => {
      const t0 = Date.now();
      if (refresh || !cutList) cutList = await withHost((h) => countParts(h, {}));
      const plan = await planCuts(cutList, loadStock(stockPaths), await solver);
      const sum = (kind: "sheet" | "bar") => plan.groups.filter((g) => g.kind === kind).reduce((s, g) => s + totals(g).stock, 0);
      const summary: Summary = {
        parts: cutList.parts.reduce((s, p) => s + p.count, 0),
        rows: cutList.parts.length,
        glueUps: cutList.glueUps.reduce((s, g) => s + g.count, 0),
        open: cutList.open.length,
        sheets: sum("sheet"),
        bars: sum("bar"),
        guessed: plan.groups.filter((g) => g.stock.guessed).length,
      };
      return { cutList, plan, summary, seconds: (Date.now() - t0) / 1000 };
    },
    get_stock: async () => ({ stock: loadStock(stockPaths) }),
    set_stock: async ({ stock: changes }) => {
      const own: Stock = readStock(stockPath);
      for (const [name, entry] of Object.entries(changes)) {
        if (entry === null) delete own[name];
        else own[name] = { ...entry, guessed: undefined };
      }
      const sorted = Object.fromEntries(Object.entries(own).sort(([a], [b]) => a.localeCompare(b)));
      mkdirSync(dirname(stockPath), { recursive: true });
      writeFileSync(`${stockPath}.tmp`, JSON.stringify(sorted, null, 2) + "\n");
      renameSync(`${stockPath}.tmp`, stockPath);
      return { stock: loadStock(stockPaths) };
    },
    show: async ({ placements }) => {
      if (!o.live) throw new Error("Show in Hew works on the document open in Hew (serve --live)");
      const path = placements[0];
      if (!path?.length) return { shown: 0, how: "none" };
      return withHost(async (h) => {
        // start from the top level, so the window isn't left inside another component
        await h.transact([{ method: "hew.view.exit_all", params: {} }]).catch(() => {});
        const leaf = path[path.length - 1];
        if (path.length > 1) {
          // a part inside components: open the window down to it, which selects it.
          // Hew answers {} even when it can't open one (an unevenly scaled instance),
          // so check where the window is before trusting it.
          await h.transact([{ method: "hew.view.enter", params: { path } }]).catch(() => {});
          const ctx = await h.query("hew.query.context", {});
          if (ctx.stack?.length) {
            await h.query("hew.view.zoom_to", { ids: [leaf] }).catch(() => {});
            return { shown: 1, how: "part" };
          }
        }
        // a loose part, or one Hew can't open: select its top-level node and frame it
        await h.query("hew.selection.set", { ids: [path[0]] });
        await h.query("hew.view.zoom_to", { ids: [path[0]] }).catch(() => {});
        return { shown: 1, how: path.length > 1 ? "outer" : "part" };
      });
    },
    export: async ({ format, sep, decimal }) => {
      if (!cutList) cutList = await withHost((h) => countParts(h, {}));
      const wantPlan = format !== "csv";
      const plan = wantPlan ? await planCuts(cutList, loadStock(stockPaths), await solver) : null;
      const t = title();
      const stem = t.replace(/\.(skp|hew)$/i, "").replace(/[^\w.-]+/g, "_") || "cutlist";
      const ext: Record<ExportFormat, [string, string]> = {
        csv: ["csv", "text/csv"], md: ["md", "text/markdown"], json: ["json", "application/json"], html: ["html", "text/html"],
      };
      return { name: `${stem}.${ext[format][0]}`, mime: `${ext[format][1]}; charset=utf-8`, text: render(format, t, cutList, plan, sep, decimal) };
    },
  };

  const { html, js } = await buildUi();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", html);
      if (req.method === "GET" && url.pathname === "/app.js") return send(res, 200, "text/javascript; charset=utf-8", js);
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        // the page is the only caller: refuse requests from other sites (no CORS, same origin only)
        const origin = req.headers.origin;
        if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return send(res, 403, "text/plain", "forbidden");
        const command = url.pathname.slice(5) as Command;
        if (!(command in handlers)) return send(res, 404, "text/plain", "unknown command");
        const params = JSON.parse((await body(req)) || "{}");
        try {
          const result = await (handlers[command] as (p: unknown) => Promise<unknown>)(params);
          return send(res, 200, "application/json", JSON.stringify(result));
        } catch (e: any) {
          return send(res, 400, "application/json", JSON.stringify({ error: e?.message ?? String(e), refusal: e?.refusal ?? null }));
        }
      }
      send(res, 404, "text/plain", "not found");
    } catch (e: any) {
      send(res, 500, "text/plain", e?.message ?? String(e));
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
  process.stderr.write(`TinyCutList: http://127.0.0.1:${port} (${o.live ? "document open in Hew" : file}); stock: ${stockPath}. Ctrl-C stops it.\n`);
  const stop = () => {
    host?.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function send(res: ServerResponse, status: number, type: string, text: string) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(text);
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let s = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      s += c;
      if (s.length > 1_000_000) fail(new Error("request too large"));
    });
    req.on("end", () => ok(s));
    req.on("error", fail);
  });
}

/** The window's page and its script, bundled from src/ui/ (esbuild, a dev dependency). */
async function buildUi(): Promise<{ html: string; js: string }> {
  const { build } = await import("esbuild");
  const out = await build({
    entryPoints: [`${root}src/ui/app.ts`],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "warning",
  });
  const html = readFileSync(`${root}src/ui/index.html`, "utf8");
  return { html, js: out.outputFiles[0].text };
}

if (import.meta.main) {
  serve(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`tinycutlist serve: ${e.message}\n`);
    process.exit(1);
  });
}
