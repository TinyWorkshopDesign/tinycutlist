// The plugin talks to Hew through this interface only. It is backed by
// `hew-cli mcp` (command line, tests) and, inside Hew, by the plugin SDK.
// Nothing else in the plugin may depend on how the bus is reached.

/** One command of a transaction, as on Hew's bus (`as` names its result for `$ref`). */
export type Command = { method: string; params?: unknown; as?: string };

/** One read-only command, for `read`. */
export type Query = { method: string; params?: Record<string, unknown> };

/** What one query of a `read` answered: its result, or the refusal it got. */
export type ReadAnswer = { ok: true; result: any } | { ok: false; error: HostError };

export type TransactOptions = { label?: string; dry_run?: boolean; expect_generation?: number };

export interface Host {
  /** One read-only command (`hew.query.*`, `hew.attr.get`, …). */
  query<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Commands in order, as one undo step; answers each command's result. */
  transact(commands: Command[], options?: TransactOptions): Promise<any[]>;
  /**
   * Many read-only commands, answered in order, one answer per query: a refusal
   * stays in its own slot. With `generation`, every answer is of that state of the
   * model (`generation_moved` otherwise).
   */
  read(queries: Query[], generation?: number): Promise<ReadAnswer[]>;
}

/** A refusal from Hew: `refusal` is its name (`unknown_entity`, `locator_missed`, …). */
export class HostError extends Error {
  readonly refusal: string | null;
  /** In a transaction: the command that was refused. */
  readonly failedIndex: number | null;
  constructor(message: string, refusal: string | null = null, failedIndex: number | null = null) {
    super(message);
    this.name = "HostError";
    this.refusal = refusal;
    this.failedIndex = failedIndex;
  }
}

/** How many reads go in one transaction: few round trips, each answer well under a message's size. */
export const READS_PER_TRANSACTION = 100;

/**
 * `read` over `hew.doc.transact`: the queries in dry-run transactions of up to
 * `size`, so a few dozen reads cost one round trip (Kurt's suggestion in hew#60).
 * Read-only commands in a dry run leave no undo entry and move nothing. A
 * refusal fails its whole transaction and names the command in `failed_index`:
 * that slot keeps the refusal, and the rest are sent again without it.
 */
export async function readInTransactions(host: Pick<Host, "transact">, queries: Query[], generation?: number, size = READS_PER_TRANSACTION): Promise<ReadAnswer[]> {
  const answers: ReadAnswer[] = new Array(queries.length);
  const options: TransactOptions = { dry_run: true, ...(generation !== undefined ? { expect_generation: generation } : {}) };
  for (let start = 0; start < queries.length; start += size) {
    let pending = queries.slice(start, start + size).map((q, i) => ({ q, at: start + i }));
    while (pending.length) {
      try {
        const results = await host.transact(pending.map((p) => ({ method: p.q.method, params: p.q.params ?? {} })), options);
        if (results.length !== pending.length) throw new HostError(`a read transaction answered ${results.length} results for ${pending.length} reads`);
        pending.forEach((p, i) => (answers[p.at] = { ok: true, result: results[i] }));
        pending = [];
      } catch (e) {
        // the model moved since `generation`: no slot is to blame, the whole read is stale
        const i = e instanceof HostError && e.refusal !== "generation_moved" ? e.failedIndex : null;
        if (i === null || i < 0 || i >= pending.length) throw e;
        answers[pending[i].at] = { ok: false, error: e as HostError };
        pending = pending.filter((_, k) => k !== i);
      }
    }
  }
  return answers;
}

/** `read` one query at a time, for hosts that answer from a recording. */
export async function readOneByOne(host: Pick<Host, "query">, queries: Query[]): Promise<ReadAnswer[]> {
  const answers: ReadAnswer[] = [];
  for (const q of queries) {
    try {
      answers.push({ ok: true, result: await host.query(q.method, q.params ?? {}) });
    } catch (e) {
      if (!(e instanceof HostError) || !e.refusal) throw e;
      answers.push({ ok: false, error: e });
    }
  }
  return answers;
}

/** The result of one answer, or its refusal thrown. */
export function resultOf<T = any>(a: ReadAnswer): T {
  if (!a.ok) throw a.error;
  return a.result as T;
}
