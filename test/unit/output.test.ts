// The CSV export and the command line's argument handling: no Hew needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ReplayHost, type Recording } from "../../src/host/replay.ts";
import { countParts } from "../../src/cutlist/count.ts";
import { formatCsv } from "../../src/cutlist/csv.ts";

const replay = async (id: string) => {
  const rec: Recording = JSON.parse(readFileSync(new URL(`../fixtures/${id}.json`, import.meta.url), "utf8"));
  return countParts(new ReplayHost(rec));
};
const lines = (csv: string) => csv.trimEnd().split("\r\n");

test("CSV: a header and one row per part, glue-ups named", async () => {
  const res = await replay("S2");
  const rows = lines(formatCsv(res));
  assert.equal(rows[0], "Label,Part,Quantity,Length (mm),Width (mm),Thickness (mm),Material,Mirrored,Glue-ups,Other names");
  assert.equal(rows.length, 1 + res.parts.length);
  const a = rows.find((r) => r.includes("Lamination A"))!;
  assert.match(a, /,4,700,50,25,Oak,,G1 Leg \([A-Z] \+ [A-Z]\),$/);
});

test("CSV for Italian spreadsheets: semicolons and decimal commas", async () => {
  const res = await replay("S2");
  res.parts[0].size = [700.5, 50, 25];
  const row = lines(formatCsv(res, { sep: ";", decimal: "," }))[1];
  assert.match(row, /;700,5;50;25;/);
});

test("CSV quotes fields that hold the separator or quotes", async () => {
  const res = await replay("S6");
  res.parts[0].name = 'Shelf, "top"';
  const row = lines(formatCsv(res))[1];
  assert.ok(row.includes('"Shelf, ""top"""'), row);
});

test("CSV refuses the same character as separator and decimal mark", async () => {
  assert.throws(() => formatCsv({ parts: [], glueUps: [], open: [], lookAlike: [] }, { sep: ",", decimal: "," }));
});

const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, HEW_CLI: "/nonexistent/hew-cli" } });

test("command line: help, and usage errors before Hew starts", () => {
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /tinycutlist <model.hew \| model.skp>/);
  assert.equal(run().status, 2, "no model");
  assert.equal(run("a.skp", "b.skp").status, 2, "two models");
  assert.equal(run("--live", "a.skp").status, 2, "--live with a file");
  assert.equal(run("a.skp", "--document", "doc_1").status, 2, "--document without --live");
  assert.equal(run("a.skp", "--format", "xml").status, 2, "unknown format");
  assert.equal(run("a.skp", "--bogus").status, 2, "unknown option");
  const missing = run("/nonexistent/model.skp");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no such file/);
});
