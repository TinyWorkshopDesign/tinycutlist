// The counting rule on recorded Hew answers: no Hew needed.
// The fixtures come from tools/record-fixtures.ts on a real build (named in each file).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ReplayHost, type Recording } from "../../src/host/replay.ts";
import { countParts } from "../../src/cutlist/count.ts";
import { formatMarkdown } from "../../src/cutlist/format.ts";
import { SCENES } from "../scenes.ts";

for (const scene of SCENES) {
  test(`${scene.id} ${scene.title}`, async () => {
    const recording: Recording = JSON.parse(readFileSync(new URL(`../fixtures/${scene.id}.json`, import.meta.url), "utf8"));
    const res = await countParts(new ReplayHost(recording));
    const errors = scene.check(res);
    assert.deepEqual(errors, [], `${errors.join("\n")}\n\n${formatMarkdown(`${scene.id} (recorded on ${recording.hew})`, res)}`);
  });
}

// hew#134: a part with a layered material reports `source: "material"` and its
// length along the grain first. S1's panel, re-answered that way (no build has it yet).
test("grain from the material: Hew's order is kept, not sorted longest first", async () => {
  const recording: Recording = JSON.parse(readFileSync(new URL("../fixtures/S1.json", import.meta.url), "utf8"));
  const plain = await countParts(new ReplayHost(recording));
  const before = plain.parts.find((p) => p.object === "obj_3")!;
  assert.deepEqual(before.size, [600, 400, 18]);
  assert.equal(before.grain, undefined);

  for (const x of recording.exchanges) {
    if (x.method === "hew.query.part_frame" && JSON.stringify(x.params.path) === JSON.stringify(["ins_c", "obj_3"])) {
      Object.assign(x.result as object, { source: "material", extents: [0.4, 0.6, 0.018] });
    }
  }
  const res = await countParts(new ReplayHost(recording));
  const p = res.parts.find((q) => q.object === "obj_3")!;
  assert.deepEqual(p.size, [400, 600, 18], "length along the grain first, though shorter than the width");
  assert.equal(p.grain, true);
});
