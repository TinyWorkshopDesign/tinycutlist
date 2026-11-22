// Host backed by `hew-cli mcp`: one headless Hew process with one private
// document, JSON-RPC over stdio. For development and tests; the plugin itself
// uses the SDK host from M3 on.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { HostError, readInTransactions, type Command, type Host, type Query, type ReadAnswer, type TransactOptions } from "./host.ts";

const runnable = (p: string) => {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** hew-cli: `HEW_CLI`, else on the PATH, else inside Hew.app on macOS. */
export function hewCliPath(): string {
  const env = process.env.HEW_CLI;
  if (env) return env;
  const exe = process.platform === "win32" ? "hew-cli.exe" : "hew-cli";
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && runnable(join(dir, exe))) return join(dir, exe);
  }
  const mac = "/Applications/Hew.app/Contents/MacOS/hew-cli";
  if (process.platform === "darwin" && runnable(mac)) return mac;
  throw new Error(
    "hew-cli not found. Set HEW_CLI to its path: it ships inside Hew (Hew.app/Contents/MacOS/hew-cli on macOS, " +
      "next to hew.exe on Windows, squashfs-root/usr/bin/hew-cli after `--appimage-extract` on Linux).",
  );
}

export class HewCliHost implements Host {
  private proc: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private waiting = new Map<number, (msg: any) => void>();

  private constructor(proc: ChildProcessWithoutNullStreams) {
    this.proc = proc;
    // if hew-cli can't start or quits, fail what's pending instead of waiting forever
    const fail = (why: string) => {
      for (const done of this.waiting.values()) done({ error: { message: why } });
      this.waiting.clear();
    };
    proc.on("error", (e) => fail(`hew-cli: ${e.message}`));
    proc.on("exit", (code, signal) => fail(`hew-cli exited (${signal ?? `code ${code}`})`));
    createInterface({ input: proc.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      const done = this.waiting.get(msg.id);
      if (done) {
        this.waiting.delete(msg.id);
        done(msg);
      }
    });
  }

  /** `args` go to `hew-cli mcp`: `["--live"]` reads the document open in the app instead of a private one. */
  static async start(cli = hewCliPath(), args: string[] = []): Promise<HewCliHost> {
    const host = new HewCliHost(spawn(cli, ["mcp", ...args], { stdio: "pipe" }));
    await host.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "tinycutlist", version: "0.0.0" },
    });
    host.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return host;
  }

  query<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.tool("hew_query", { method, params });
  }

  async transact(commands: Command[], options: TransactOptions = {}): Promise<any[]> {
    const res = await this.tool("hew_transact", { commands, ...options });
    return res.results ?? [];
  }

  /** Reads in dry-run transactions: one round trip for many reads. */
  read(queries: Query[], generation?: number): Promise<ReadAnswer[]> {
    return readInTransactions(this, queries, generation);
  }

  /** Opens a model file in the private document (read-only for the file on disk). */
  async open(path: string): Promise<void> {
    await this.transact([{ method: "hew.doc.open", params: { path } }]);
  }

  close(): void {
    this.proc.stdin.end();
    this.proc.kill();
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) {
        reject(new HostError("hew-cli is not running"));
        return;
      }
      this.waiting.set(id, (msg) => (msg.error ? reject(new HostError(msg.error.message)) : resolve(msg.result)));
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  private async tool(name: string, args: unknown): Promise<any> {
    const res = await this.request("tools/call", { name, arguments: args });
    let content = res.structuredContent;
    if (content === undefined || content === null) {
      const text = (res.content ?? []).map((c: any) => c.text ?? "").join("");
      try {
        content = JSON.parse(text);
      } catch {
        throw new HostError(text.trim() || "empty answer from Hew");
      }
    }
    if (content.error) {
      const data = content.error.data ?? {};
      throw new HostError(data.explanation ?? content.error.message ?? "refused", data.refusal ?? null, typeof data.failed_index === "number" ? data.failed_index : null);
    }
    return content.result ?? {};
  }
}
