// Loads the single-threaded PackingSolver module (solver/CMakeLists.txt) in Node.
// It lives in solver/dist, fetched from a release (`npm run solver:fetch`) or
// built from source (`npm run solver:build`), or wherever TINYCUTLIST_SOLVER points.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Solver } from "./cutlist/nesting.ts";

export function solverDir(): string {
  return process.env.TINYCUTLIST_SOLVER ?? fileURLToPath(new URL("../solver/dist/", import.meta.url));
}

let loaded: Promise<Solver> | null = null;

/** PackingSolver's `solve`, loaded once. `solve` blocks while it computes. */
export function loadSolver(dir = solverDir()): Promise<Solver> {
  loaded ??= (async () => {
    const js = join(dir, "packingsolver.js");
    if (!existsSync(js)) {
      throw new Error(
        `PackingSolver isn't installed (no ${js}). Run \`npm run solver:fetch\` to download it, ` +
          "or `npm run solver:build` to build it with Emscripten.",
      );
    }
    const { default: PackingSolver } = await import(pathToFileURL(js).href);
    const m = await PackingSolver();
    return (type: string, instance: string, params: string) => m.solve(type, instance, params) as string;
  })();
  return loaded;
}
