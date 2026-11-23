// The title of a document open in Hew, as `hew-cli documents --live` lists it.

import { execFileSync } from "node:child_process";
import { hewCliPath } from "./host/hew-cli.ts";

/** The live document's title, as `hew-cli documents --live` lists it (front window unless `ref` names one). */
export function liveTitle(ref?: string): string | null {
  try {
    const docs = execFileSync(hewCliPath(), ["documents", "--live"], { encoding: "utf8", timeout: 10000 })
      .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const d = docs.find((x: any) => (ref ? [x.id, x.path, x.title].includes(ref) : x.front));
    return d?.title ?? null;
  } catch {
    return null;
  }
}
