// PackingSolver inside Hew: the package's solver/worker.js (PackingSolver's
// loader plus src/plugin/solver-worker.js, built by tools/plugin-build.ts) runs
// in a nested Worker started from a blob, the one kind Hew's realm allows.
// The plugin reads the .wasm from its package, compiles it once, and hands
// the compiled module to the Worker. Solves run one at a time, in order.

import type { Solver } from "../cutlist/nesting.ts";

export type Assets = { bytes(path: string): Promise<ArrayBuffer> };

type Waiting = { resolve(text: string): void; reject(e: Error): void };

export class WebSolver {
  private started: Promise<Worker> | null = null;
  private waiting = new Map<number, Waiting>();
  private nextId = 1;
  private url: string | null = null;

  private readonly assets: Assets;

  constructor(assets: Assets) {
    this.assets = assets;
  }

  /** PackingSolver's `solve`, as nesting.ts calls it. */
  readonly solve: Solver = async (type, instance, params) => {
    const worker = await (this.started ??= this.start());
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      worker.postMessage({ id, type, instance, params });
    });
  };

  /** Ends the Worker and fails what waits; the next solve starts a new one. */
  stop(why = "the solver was stopped"): void {
    const started = this.started;
    this.started = null;
    started?.then((w) => w.terminate(), () => {});
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    for (const w of this.waiting.values()) w.reject(new Error(why));
    this.waiting.clear();
  }

  private async start(): Promise<Worker> {
    try {
      const [js, wasm] = await Promise.all([this.assets.bytes("solver/worker.js"), this.assets.bytes("solver/packingsolver.wasm")]);
      const module = await WebAssembly.compile(wasm);
      const url = (this.url = URL.createObjectURL(new Blob([js], { type: "text/javascript" })));
      // the URL stays valid while the Worker lives: WebKit may still be loading it after `new Worker`
      const worker = new Worker(url);
      worker.onmessage = (e: MessageEvent) => {
        const d = e.data;
        const w = this.waiting.get(d.id);
        if (!w) return;
        this.waiting.delete(d.id);
        if (d.ok) w.resolve(d.result);
        else w.reject(new Error(`PackingSolver: ${d.error}`));
      };
      worker.onerror = (e: ErrorEvent) => {
        e.preventDefault();
        this.stop(`PackingSolver stopped: ${e.message || "error in its Worker"}`);
      };
      worker.postMessage({ module });
      return worker;
    } catch (e) {
      this.started = null;
      throw e;
    }
  }
}
