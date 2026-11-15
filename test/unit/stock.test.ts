// Stock files and presets: no Hew, no solver.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRESETS, presetFor } from "../../src/cutlist/presets.ts";
import { NO_MATERIAL, addMissing, guessEntry, loadStock, resolve } from "../../src/cutlist/stock.ts";

test("presets: material names in Italian and English find the right preset", () => {
  const cases: [string, string | null][] = [
    ["Multistrato Pioppo 18", "plywood-poplar"],
    ["Multistrato Pino Cileno B/C WBP marino", "plywood-pine"],
    ["Multistrato Okoumè marino", "plywood-okoume"],
    ["Birch plywood 18", "plywood-birch"],
    ["Multistrato Bilaminato Bianco", "plywood-faced"],
    ["Compensato Rovere 4", "thin-plywood"],
    ["MDF idrofugo 19", "mdf"],
    ["HDF bianco", "hdf"],
    ["Truciolare nobilitato bianco", "chipboard-melamine"],
    ["Truciolare grezzo", "chipboard"],
    ["OSB 3", "osb"],
    ["Listellare frassino", "blockboard"],
    ["Lamellare 3 strati abete", "panel-3-layer"],
    ["Lamellare abete 18", "panel-spruce"],
    ["Lamellare faggio", "panel-hardwood"],
    ["Rovere", null],
    ["Steel", null],
  ];
  for (const [name, id] of cases) assert.equal(presetFor(name)?.id ?? null, id, name);
});

test("presets: full sheets only, length first", () => {
  for (const p of PRESETS) {
    assert.ok(p.sheets.length >= 1 && p.sheets.length <= 3, p.id);
    for (const [l, w] of p.sheets) assert.ok(l >= w && w >= 1200, `${p.id}: ${l} × ${w}`);
  }
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length, "ids are unique");
});

test("guesses: a preset by name, else by type, else sheet goods", () => {
  assert.deepEqual(guessEntry("Multistrato betulla 18").sheets, [[2500, 1250], [1525, 1525]]);
  assert.equal(guessEntry("Multistrato betulla 18").preset, "plywood-birch");
  assert.equal(guessEntry("Listello abete").kind, "bar");
  assert.equal(guessEntry("Rovere").grain, true);
  assert.equal(guessEntry("Steel").kind, "list");
  assert.equal(guessEntry(null).kind, "sheet");
  assert.equal(guessEntry("Whatever", "dimensional").kind, "bar");
});

test("resolve: the user's entry wins; a preset fills what it leaves out", () => {
  const stock = {
    "My birch": { kind: "sheet" as const, preset: "plywood-birch" },
    "My MDF": { kind: "sheet" as const, sheets: [[2440, 1220]] as [number, number][], kerf: 2.5 },
  };
  const birch = resolve(stock, "My birch");
  assert.deepEqual(birch.sheets, [[2500, 1250], [1525, 1525]]);
  assert.equal(birch.grain, true);
  assert.equal(birch.guessed, false);
  const mdf = resolve(stock, "My MDF");
  assert.deepEqual(mdf.sheets, [[2440, 1220]]);
  assert.equal(mdf.kerf, 2.5);
  assert.equal(mdf.trim, 10);
  assert.equal(resolve(stock, "Unknown oak").guessed, true);
  assert.throws(() => resolve({ X: { kind: "sheet", preset: "nope" } }, "X"), /unknown preset/);
});

test("stock files: a project's file overrides the global one, material by material", () => {
  const dir = mkdtempSync(join(tmpdir(), "tcl-stock-"));
  try {
    const global = join(dir, "global.json");
    const project = join(dir, "project.json");
    writeFileSync(global, JSON.stringify({ A: { kind: "bar", bars: [3000] }, B: { kind: "list" } }));
    writeFileSync(project, JSON.stringify({ B: { kind: "sheet", sheets: [[1000, 500]] } }));
    const s = loadStock([global, project, join(dir, "missing.json")]);
    assert.equal(s.A.kind, "bar");
    assert.equal(s.B.kind, "sheet");
    writeFileSync(project, "[1,2]");
    assert.throws(() => loadStock([project]), /expected an object/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stock command: adds only the missing materials, guessed, and keeps the user's", () => {
  const dir = mkdtempSync(join(tmpdir(), "tcl-stock-"));
  try {
    const path = join(dir, "sub", "stock.json");
    assert.deepEqual(addMissing(path, [{ name: "Multistrato pioppo 18", type: "unknown" }, { name: null, type: "unknown" }]), ["Multistrato pioppo 18", NO_MATERIAL]);
    const first = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(first["Multistrato pioppo 18"].preset, "plywood-poplar");
    assert.equal(first["Multistrato pioppo 18"].guessed, true);
    first["Multistrato pioppo 18"] = { kind: "sheet", sheets: [[2440, 1220]] };
    writeFileSync(path, JSON.stringify(first));
    assert.deepEqual(addMissing(path, [{ name: "Multistrato pioppo 18", type: "unknown" }, { name: "OSB", type: "unknown" }]), ["OSB"]);
    const second = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(second["Multistrato pioppo 18"], { kind: "sheet", sheets: [[2440, 1220]] }, "the user's entry is untouched");
    assert.deepEqual(addMissing(path, [{ name: "OSB", type: "unknown" }]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
