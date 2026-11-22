// Builds the plugin package Hew installs, in dist/plugin/:
//
//   hew-plugin.json          the manifest at the repository's root
//   background.js            src/plugin/main.ts bundled into one classic script
//   solver/worker.js         PackingSolver's loader made a classic script, plus src/plugin/solver-worker.js
//   solver/packingsolver.wasm
//   LICENSE, solver/LICENSES.txt
//
// Hew runs `main` as a classic script in its realm Worker, where `import`,
// `importScripts` and fetch are refused, so everything is bundled, and the
// solver's files are read with `hew.assets`. In Hew, Settings > Plugins >
// install from a folder (developer mode) takes dist/plugin.
//
//   node tools/plugin-build.ts [--out <folder>]

import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = values.out ?? join(root, "dist", "plugin");
const solverDir = process.env.TINYCUTLIST_SOLVER ?? join(root, "solver", "dist");

for (const f of ["packingsolver.js", "packingsolver.wasm"]) {
  if (!existsSync(join(solverDir, f))) {
    console.error(`plugin-build: no ${join(solverDir, f)}. Run \`npm run solver:fetch\` first.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "solver"), { recursive: true });

const manifest = JSON.parse(readFileSync(join(root, "hew-plugin.json"), "utf8"));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
if (version) manifest.version = version;
writeFileSync(join(out, "hew-plugin.json"), JSON.stringify(manifest, null, 2) + "\n");

await build({
  entryPoints: [join(root, "src", "plugin", "main.ts")],
  outfile: join(out, manifest.main),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  legalComments: "inline",
  banner: { js: `// TinyCutList ${manifest.version} — GPL-3.0 — ${manifest.source}` },
  logLevel: "warning",
});

// PackingSolver's loader is an ES module (Emscripten's EXPORT_ES6). A nested
// Worker in Hew must be classic: drop the export and the import.meta it uses
// to find its files (the plugin hands it the compiled module instead).
let loader = readFileSync(join(solverDir, "packingsolver.js"), "utf8");
const exportLine = /export\s+default\s+PackingSolver\s*;?\s*$/;
if (!exportLine.test(loader)) throw new Error("plugin-build: packingsolver.js doesn't end in `export default PackingSolver`");
loader = loader.replace(exportLine, "").replaceAll("import.meta.url", '""');
if (/\bimport\.meta\b/.test(loader)) throw new Error("plugin-build: packingsolver.js still uses import.meta");
// embind builds its call wrappers with `new Function`, which Hew's realm refuses
// (no 'unsafe-eval'): swap that one function for src/plugin/embind-invoker.js.
const invoker = /function createJsInvoker\(argTypes,isClassMethodFunc,returns,isAsync\)\{[\s\S]*?return new Function\(args1,invokerFnBody\)\}/;
if (!invoker.test(loader)) throw new Error("plugin-build: packingsolver.js has no createJsInvoker in the expected shape (a new Emscripten?)");
loader = loader.replace(invoker, () => readFileSync(join(root, "src", "plugin", "embind-invoker.js"), "utf8").trim());
if (/new Function|\beval\(/.test(loader)) throw new Error("plugin-build: packingsolver.js still generates code at run time");
const shim = readFileSync(join(root, "src", "plugin", "solver-worker.js"), "utf8");
writeFileSync(join(out, "solver", "worker.js"), `${loader}\n;\n${shim}`);

copyFileSync(join(solverDir, "packingsolver.wasm"), join(out, "solver", "packingsolver.wasm"));
if (existsSync(join(solverDir, "LICENSES.txt"))) copyFileSync(join(solverDir, "LICENSES.txt"), join(out, "solver", "LICENSES.txt"));
copyFileSync(join(root, "LICENSE"), join(out, "LICENSE"));

console.log(`plugin-build: ${manifest.id} ${manifest.version} → ${out}`);
