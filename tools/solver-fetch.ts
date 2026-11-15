// Downloads the prebuilt single-threaded PackingSolver module into solver/dist,
// from the GitHub release named in solver/manifest.json, and checks each file's
// SHA-256 against the manifest. Nothing is kept if a checksum doesn't match.
//   npm run solver:fetch

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../solver/manifest.json", import.meta.url), "utf8"));
const dist = new URL("../solver/dist/", import.meta.url);
mkdirSync(dist, { recursive: true });

const files: [string, Buffer][] = [];
for (const [name, sha256] of Object.entries(manifest.files as Record<string, string>)) {
  const url = `https://github.com/${manifest.repository}/releases/download/${manifest.release}/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(data).digest("hex");
  if (got !== sha256) throw new Error(`${name}: checksum mismatch (expected ${sha256}, got ${got})`);
  files.push([name, data]);
  console.log(`${name}: ${data.length} bytes, checksum ok`);
}
for (const [name, data] of files) {
  writeFileSync(new URL(`${name}.part`, dist), data);
  renameSync(new URL(`${name}.part`, dist), new URL(name, dist));
}
console.log(`PackingSolver ${manifest.packingsolver} in solver/dist`);
