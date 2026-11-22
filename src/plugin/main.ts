// The plugin's background script inside Hew (`main` in the package's
// hew-plugin.json). tools/plugin-build.ts bundles it into one classic script,
// which Hew runs in the plugin's Worker after the SDK runtime has defined
// `hew`. Hew has no plugin windows yet, so TinyCutList answers bus commands:
// a caller (an agent, hew-cli, another plugin) asks, the plugin reads the
// model and answers. Each command's schema is in hew-plugin.json.

import { commands, cutList, type CutListParams } from "../background.ts";
import type { CountOptions } from "../cutlist/count.ts";
import type { Stock } from "../cutlist/stock.ts";
import { SdkHost, type SdkHew } from "../host/sdk.ts";
import { WebSolver, type Assets } from "./solver.ts";

type Ctx = { signal: AbortSignal };
declare const hew: SdkHew & {
  assets: Assets;
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  commands: { handle(id: string, fn: (params: any, ctx: Ctx) => unknown): void };
};

/** The stock the plugin keeps (material name → entry), in its own storage: the plugin's global stock file. */
const STOCK_KEY = "stock";

const host = new SdkHost(hew);
const solver = new WebSolver(hew.assets);

async function storedStock(): Promise<Stock> {
  const s = await hew.storage.get(STOCK_KEY);
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Stock) : {};
}

hew.commands.handle("count_parts", (params: CountOptions | undefined) => commands.count_parts(host, params ?? {}));

hew.commands.handle("cut_list", (params: CutListParams | undefined, ctx: Ctx) => {
  // a call that times out or is cancelled must not leave a solve running for the next one
  const abort = () => solver.stop("the command was cancelled");
  ctx.signal.addEventListener("abort", abort, { once: true });
  return cutList(host, params ?? {}, { solver: async () => solver.solve, stock: storedStock }).finally(() =>
    ctx.signal.removeEventListener("abort", abort),
  );
});

hew.commands.handle("get_stock", async () => ({ stock: await storedStock() }));

hew.commands.handle("set_stock", async (params: { stock: Stock; merge?: boolean }) => {
  const stock = params.merge === false ? params.stock : { ...(await storedStock()), ...params.stock };
  await hew.storage.set(STOCK_KEY, stock);
  return { stock };
});
