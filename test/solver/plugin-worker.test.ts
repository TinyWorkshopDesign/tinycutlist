// The solver as the plugin runs it inside Hew: the package's solver/worker.js
// (PackingSolver's loader made a classic script, plus src/plugin/solver-worker.js)
// run as a classic script in a bare context with only what a Worker has, handed
// a compiled module as the plugin does. Its answer must match the Node module's.
// Skipped when PackingSolver isn't installed (npm run solver:fetch).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { loadSolver, solverDir } from "../../src/solver.ts";

const skip = existsSync(join(solverDir(), "packingsolver.js")) ? false : "PackingSolver isn't installed (npm run solver:fetch)";
const root = new URL("../../", import.meta.url).pathname;

// the shape src/cutlist/nesting.ts sends for sheets, in tenths of a millimeter
const INSTANCE = JSON.stringify({
  objective: "bin-packing-with-leftovers",
  cut_type: "non-exact",
  number_of_stages: 3,
  cut_thickness: 32,
  bin_types: [{ width: 15250, height: 15250, copies: 10, cost: 1525 * 1525 }],
  item_types: [
    { width: 7200, height: 5600, copies: 4, oriented: true },
    { width: 6000, height: 4000, copies: 6, oriented: false },
  ],
});

test("the package's solver/worker.js solves like the Node module", { skip }, async () => {
  const out = mkdtempSync(join(tmpdir(), "tcl-plugin-"));
  try {
    execFileSync(process.execPath, [join(root, "tools/plugin-build.ts"), "--out", out], { stdio: "pipe" });
    const script = readFileSync(join(out, "solver/worker.js"), "utf8");
    const module = await WebAssembly.compile(readFileSync(join(out, "solver/packingsolver.wasm")));

    const answers: any[] = [];
    let waiting: ((v: any) => void) | null = null;
    const ctx: any = {
      WebAssembly,
      postMessage: (d: any) => (waiting ? (waiting(d), (waiting = null)) : answers.push(d)),
      console,
      setTimeout,
      clearTimeout,
      TextDecoder,
      TextEncoder,
      performance,
      crypto,
      WorkerGlobalScope: function WorkerGlobalScope() {},
    };
    ctx.globalThis = ctx;
    ctx.self = ctx;
    // Hew's realm has no unsafe-eval: neither has this context
    runInNewContext(script, ctx, { contextCodeGeneration: { strings: false, wasm: true } });
    const ask = (msg: unknown) => new Promise<any>((resolve) => ((waiting = resolve), ctx.onmessage({ data: msg })));

    ctx.onmessage({ data: { module } });
    const params = JSON.stringify({ optimization_mode: "not-anytime-sequential" });
    const got = await ask({ id: 7, type: "rectangleguillotine", instance: INSTANCE, params });
    assert.equal(got.id, 7);
    assert.equal(got.ok, true, got.error);
    const node = await loadSolver();
    const want = JSON.parse(await node("rectangleguillotine", INSTANCE, params));
    const have = JSON.parse(got.result);
    assert.equal(have.error, undefined);
    assert.ok(typeof have.certificate === "string" && have.certificate.includes("\n"), "a cutting certificate");
    assert.equal(have.certificate, want.certificate);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
