// Host backed by Hew's plugin SDK: the `hew` global the runtime defines in the
// plugin's Worker (sdk/plugin in Hew's repository). Every call is a
// postMessage to Hew's page and back, through the plugin's own connection
// and grant; nothing here reaches hew-cli or a socket.

import { HostError, type Command, type Host } from "./host.ts";

/** The part of the SDK's `hew` this host uses. */
export type SdkHew = {
  /** The generated client: `api.query.partFrame(params)` sends `hew.query.part_frame`. */
  readonly api: Record<string, Record<string, ((params: unknown) => Promise<any>) | undefined> | undefined>;
};

/**
 * Hew stops a plugin that sends more than 1,000 messages in any rolling second
 * (PLUGINS.md, "The port"), and a cut list of a large model reads far faster
 * than that inside Hew. So calls go out at most `perSecond` in any rolling
 * second, waiting their turn on a timer (which also lets Hew's pings through).
 */
export class RateLimit {
  private sent: number[] = [];
  private readonly perSecond: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(perSecond: number, now = () => performance.now(), sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
    this.perSecond = perSecond;
    this.now = now;
    this.sleep = sleep;
  }

  /** Resolves when one more call may go out, and counts it. */
  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      while (this.sent.length && this.sent[0] <= t - 1000) this.sent.shift();
      if (this.sent.length < this.perSecond) {
        this.sent.push(t);
        return;
      }
      await this.sleep(this.sent[0] + 1000 - t + 1);
    }
  }
}

const camel = (snake: string) => snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** The SDK's error as a HostError: a refusal keeps its name (`locator_missed`, …). */
function toHostError(e: any): HostError {
  const r = e?.refusal;
  if (r && typeof r.refusal === "string") return new HostError(r.explanation || e.message, r.refusal);
  return new HostError(e?.message ?? String(e));
}

export class SdkHost implements Host {
  private readonly hew: SdkHew;
  private readonly limit: RateLimit;

  /** `perSecond` stays under Hew's 1,000, with room for the SDK's own messages (storage, assets, console). */
  constructor(hew: SdkHew, limit = new RateLimit(800)) {
    this.hew = hew;
    this.limit = limit;
  }

  /** `hew.<group>.<name>` is `hew.api.<group>.<camelName>` in the SDK's client. */
  private method(method: string): (params: unknown) => Promise<any> {
    const [root, group, name, ...rest] = method.split(".");
    const fn = root === "hew" && group && name && !rest.length ? this.hew.api[group]?.[camel(name)] : undefined;
    if (typeof fn !== "function") throw new HostError(`${method} isn't in this Hew's plugin API`, "unknown_method");
    return fn;
  }

  async query<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const fn = this.method(method);
    await this.limit.take();
    try {
      return await fn(params);
    } catch (e) {
      throw toHostError(e);
    }
  }

  async transact(commands: Command[], options: { label?: string; dry_run?: boolean } = {}): Promise<any[]> {
    const fn = this.method("hew.doc.transact");
    await this.limit.take();
    try {
      const res = await fn({ commands, ...options });
      return res?.results ?? [];
    } catch (e) {
      throw toHostError(e);
    }
  }
}
