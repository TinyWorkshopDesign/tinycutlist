// The command line against a real Hew build: a scene saved as .hew, then read back by `tinycutlist`.
// Skipped unless HEW_CLI is set.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HewCliHost } from "../../src/host/hew-cli.ts";
import { SCENES } from "../scenes.ts";

const skip = process.env.HEW_CLI ? false : "set HEW_CLI to run against Hew";
const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

test("tinycutlist reads a saved model in every format, and leaves the file alone", { skip }, async () => {
  const dir = mkdtempSync(join(process.env.TCL_TMP ?? tmpdir(), "tinycutlist-"));
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

    const json = spawnSync(process.execPath, [cli, model, "-f", "json"], { encoding: "utf8" });
    assert.equal(json.status, 0, json.stderr);
    const res = JSON.parse(json.stdout);
    assert.equal(res.glueUps.length, 2);
    assert.match(json.stderr, /glue-ups\.hew: \d+ parts in \d+ rows, 2 glue-ups/);

    const csvFile = join(dir, "list.csv");
    const csv = spawnSync(process.execPath, [cli, model, "-o", csvFile, "--sep", ";", "--decimal", ","], { encoding: "utf8" });
    assert.equal(csv.status, 0, csv.stderr);
    assert.match(readFileSync(csvFile, "utf8"), /^Label;Part;Quantity;/);

    const md = spawnSync(process.execPath, [cli, model], { encoding: "utf8" });
    assert.equal(md.status, 0, md.stderr);
    assert.match(md.stdout, /^# glue-ups\.hew\n/);
    assert.match(md.stdout, /## Glue-ups/);

    assert.equal(statSync(model).mtimeMs, before, "the model file is not written back");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
