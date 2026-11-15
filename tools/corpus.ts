// Counts the parts of real model files (.hew or .skp) and prints each cut list.
//   HEW_CLI=/path/to/hew-cli node tools/corpus.ts [--out dir] model1.skp model2.hew …
// Each file opens in a private headless session; nothing is written back.

import { mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { HewCliHost } from "../src/host/hew-cli.ts";
import { countParts } from "../src/cutlist/count.ts";
import { formatMarkdown } from "../src/cutlist/format.ts";

const args = process.argv.slice(2);
const outDir = args.includes("--out") ? args.splice(args.indexOf("--out"), 2)[1] : null;
if (outDir) mkdirSync(outDir, { recursive: true });

let failed = 0;
for (const file of args) {
  const host = await HewCliHost.start();
  const t0 = Date.now();
  try {
    await host.transact([{ method: "hew.doc.open", params: { path: file } }]);
    const res = await countParts(host);
    const text = formatMarkdown(`${basename(file)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`, res);
    console.log(text + "\n");
    if (outDir) {
      const stem = basename(file).replace(/\.[^.]+$/, "");
      writeFileSync(`${outDir}/${stem}.md`, text + "\n");
      writeFileSync(`${outDir}/${stem}.json`, JSON.stringify(res, null, 2) + "\n");
    }
  } catch (e: any) {
    failed++;
    console.log(`# ${basename(file)}\n\nERROR ${e.refusal ?? ""} ${e.message}\n`);
  } finally {
    host.close();
  }
}
process.exit(failed ? 1 : 0);
