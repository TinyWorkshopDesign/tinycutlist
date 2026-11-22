import { test } from "node:test";
import assert from "node:assert/strict";
import { HostError } from "../../src/host/host.ts";
import { RateLimit, SdkHost } from "../../src/host/sdk.ts";

// A stand-in for the SDK's generated client: records what it is asked.
function fakeHew() {
  const calls: [string, unknown][] = [];
  const answer = (name: string, result: unknown) => async (params: unknown) => {
    calls.push([name, params]);
    return result;
  };
  const refusal = Object.assign(new Error("Hew refused"), {
    refusal: { refusal: "locator_missed", explanation: "No placement at that path.", failed_index: 0, failed_method: "hew.query.part_frame", detail: null },
  });
  const api = {
    query: {
      partFrame: async (params: unknown) => {
        calls.push(["partFrame", params]);
        throw refusal;
      },
      occurrences: answer("occurrences", { occurrences: [], generation: 3 }),
    },
    attr: { get: answer("attr.get", { value: 1 }) },
    doc: { transact: answer("transact", { results: [{ a: 1 }, { b: 2 }] }) },
  };
  return { hew: { api }, calls };
}

test("hew.<group>.<snake_name> goes to the SDK client's api.<group>.<camelName>", async () => {
  const { hew, calls } = fakeHew();
  const host = new SdkHost(hew);
  assert.deepEqual(await host.query("hew.query.occurrences", { include_hidden: false }), { occurrences: [], generation: 3 });
  assert.deepEqual(await host.query("hew.attr.get", { target: "mat_1" }), { value: 1 });
  assert.deepEqual(calls, [["occurrences", { include_hidden: false }], ["attr.get", { target: "mat_1" }]]);
});

test("a refusal keeps its name; a method the SDK lacks is refused before sending", async () => {
  const { hew } = fakeHew();
  const host = new SdkHost(hew);
  await assert.rejects(
    host.query("hew.query.part_frame", { path: ["obj_1"] }),
    (e: unknown) => e instanceof HostError && e.refusal === "locator_missed" && e.message === "No placement at that path.",
  );
  await assert.rejects(host.query("hew.query.nothing_here"), (e: unknown) => e instanceof HostError && e.refusal === "unknown_method");
  await assert.rejects(host.query("not.a.hew.method"), /isn't in this Hew's plugin API/);
});

test("transact sends one hew.doc.transact and answers its results", async () => {
  const { hew, calls } = fakeHew();
  const host = new SdkHost(hew);
  const cmds = [{ method: "hew.query.signature", params: { path: ["obj_1"] } }];
  assert.deepEqual(await host.transact(cmds, { dry_run: true }), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(calls, [["transact", { commands: cmds, dry_run: true }]]);
});

test("at most perSecond calls in any rolling second", async () => {
  let clock = 0;
  const slept: number[] = [];
  const limit = new RateLimit(3, () => clock, async (ms) => {
    slept.push(ms);
    clock += ms;
  });
  const times: number[] = [];
  for (let i = 0; i < 7; i++) {
    await limit.take();
    times.push(clock);
    clock += 10;
  }
  for (let i = 3; i < times.length; i++) assert.ok(times[i] - times[i - 3] >= 1000, `call ${i} waits a second after call ${i - 3}`);
  assert.equal(slept.length, 2);
});
