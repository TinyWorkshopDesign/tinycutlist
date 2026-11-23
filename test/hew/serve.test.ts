// `tinycutlist serve` against a real Hew build: a scene saved as .hew, served,
// and the window's commands called over HTTP as the page does.
// Skipped unless HEW_CLI is set (and needs the solver: npm run solver:fetch).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HewCliHost } from "../../src/host/hew-cli.ts";
import { solverDir } from "../../src/solver.ts";
import { SCENES } from "../scenes.ts";

const skip = !process.env.HEW_CLI ? "set HEW_CLI to run against Hew" : !existsSync(join(solverDir(), "packingsolver.js")) ? "no solver: npm run solver:fetch" : false;
const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

test("tinycutlist serve answers the window's commands, writes only its stock file, and leaves the model alone", { skip, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(process.env.TCL_TMP ?? tmpdir(), "tinycutlist-serve-"));
  const port = 8900 + Math.floor(Math.random() * 90);
  const base = `http://127.0.0.1:${port}`;
  let proc: ReturnType<typeof spawn> | null = null;
  try {
    const model = join(dir, "glue-ups.hew");
    const host = await HewCliHost.start();
    try {
      await SCENES.find((s) => s.id === "S7")!.build(host);
      await host.transact([{ method: "hew.doc.save", params: { path: model } }]);
    } finally {
      host.close();
    }
    const before = statSync(model).mtimeMs;
    const config = join(dir, "config");

    proc = spawn(process.execPath, [cli, "serve", model, "--port", String(port)], {
      env: { ...process.env, TINYCUTLIST_CONFIG: config },
      stdio: ["ignore", "ignore", "pipe"],
    });
    // wait for the line saying it listens
    await new Promise<void>((ok, fail) => {
      let err = "";
      const t = setTimeout(() => fail(new Error(`serve didn't start: ${err}`)), 30_000);
      proc!.stderr!.on("data", (d) => {
        err += d;
        if (err.includes(base)) {
          clearTimeout(t);
          ok();
        }
      });
      proc!.on("exit", (code) => fail(new Error(`serve exited (${code}): ${err}`)));
    });

    const call = async (command: string, params: unknown = {}, origin = base) => {
      const res = await fetch(`${base}/api/${command}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(params) });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    const page = await fetch(base).then((r) => r.text());
    assert.match(page, /<title>TinyCutList<\/title>/);
    assert.match(await fetch(`${base}/app.js`).then((r) => r.text()), /cut_list/, "the window's script is served");

    const info = await call("info");
    assert.equal(info.body.title, "glue-ups.hew");
    assert.equal(info.body.live, false);
    assert.equal(info.body.canShow, false);

    const cl = await call("cut_list", { refresh: true });
    assert.equal(cl.status, 200);
    assert.ok(cl.body.cutList.parts.length > 0, "parts");
    assert.ok(cl.body.plan.groups.length > 0, "plans");
    assert.equal(cl.body.summary.parts, cl.body.cutList.parts.reduce((s: number, p: any) => s + p.count, 0));
    assert.ok(cl.body.summary.guessed > 0, "nothing in the stock yet: guessed");

    // save one material's stock: it lands in the config folder, and the plan uses it
    const mat = cl.body.plan.groups.find((g: any) => g.kind === "sheet").material ?? "(no material)";
    const set = await call("set_stock", { stock: { [mat]: { kind: "sheet", sheets: [[1200, 600]], kerf: 3, trim: 5, grain: false } } });
    assert.equal(set.status, 200);
    const onDisk = JSON.parse(readFileSync(join(config, "stock.json"), "utf8"));
    assert.deepEqual(onDisk[mat].sheets, [[1200, 600]]);
    assert.equal(onDisk[mat].guessed, undefined);
    const again = await call("cut_list", {});
    const g = again.body.plan.groups.find((x: any) => (x.material ?? "(no material)") === mat && x.kind === "sheet");
    assert.ok(g.sheets.every((s: any) => s.length === 1200 && s.width === 600), "the plan uses the saved size");
    assert.equal(g.stock.guessed, false);

    // removing it goes back to the guess
    await call("set_stock", { stock: { [mat]: null } });
    assert.equal(JSON.parse(readFileSync(join(config, "stock.json"), "utf8"))[mat], undefined);

    const csv = await call("export", { format: "csv", sep: ";", decimal: "," });
    assert.equal(csv.body.name, "glue-ups.csv");
    assert.match(csv.body.text, /^Label;Part;/);
    const html = await call("export", { format: "html" });
    assert.match(html.body.text, /^<!doctype html>/);

    // "show in Hew" needs the open document; other sites are refused
    assert.equal((await call("show", { placements: [["obj_1"]] })).status, 400);
    assert.equal((await call("info", {}, "https://example.com")).status, 403);
    assert.equal(statSync(model).mtimeMs, before, "the model file isn't written");
  } finally {
    proc?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
