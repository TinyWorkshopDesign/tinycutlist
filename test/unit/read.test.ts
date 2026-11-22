import { test } from "node:test";
import assert from "node:assert/strict";
import { HostError, readInTransactions, type Command, type TransactOptions } from "../../src/host/host.ts";

// A transact that answers each read with its path, refuses the paths in `refuse`
// the way Hew does (the whole envelope, naming the slot), and logs every envelope.
function fakeTransact(refuse: string[] = [], moved = false) {
  const sent: { paths: string[]; options?: TransactOptions }[] = [];
  return {
    sent,
    async transact(commands: Command[], options?: TransactOptions) {
      const paths = commands.map((c) => (c.params as any).path);
      sent.push({ paths, options });
      if (moved) throw new HostError("the model changed", "generation_moved", 0);
      const i = paths.findIndex((p) => refuse.includes(p));
      if (i >= 0) throw new HostError(`no ${paths[i]}`, "locator_missed", i);
      return paths.map((p) => ({ path: p }));
    },
  };
}
const q = (path: string) => ({ method: "hew.query.part_frame", params: { path } });

test("reads go in dry-run transactions of at most `size`, with the generation, answered in order", async () => {
  const host = fakeTransact();
  const answers = await readInTransactions(host, ["a", "b", "c", "d", "e"].map(q), 81, 2);
  assert.deepEqual(answers.map((a) => a.ok && a.result.path), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(host.sent.map((s) => s.paths), [["a", "b"], ["c", "d"], ["e"]]);
  assert.deepEqual(host.sent[0].options, { dry_run: true, expect_generation: 81 });
});

test("a refused read keeps its refusal in its slot; the others are sent again without it", async () => {
  const host = fakeTransact(["b", "d"]);
  const answers = await readInTransactions(host, ["a", "b", "c", "d"].map(q));
  assert.deepEqual(answers.map((a) => (a.ok ? a.result.path : a.error.refusal)), ["a", "locator_missed", "c", "locator_missed"]);
  assert.deepEqual(host.sent.map((s) => s.paths), [["a", "b", "c", "d"], ["a", "c", "d"], ["a", "c"]]);
  assert.deepEqual(host.sent[0].options, { dry_run: true });
});

test("generation_moved fails the whole read", async () => {
  await assert.rejects(readInTransactions(fakeTransact([], true), ["a", "b"].map(q), 5), (e: unknown) => e instanceof HostError && e.refusal === "generation_moved");
});
