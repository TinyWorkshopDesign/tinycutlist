// The window's bridge to `tinycutlist serve`: each command is a POST to /api/<command>.
// From Hew's M3 on, a bridge over the plugin SDK takes its place (same commands).

import type { Bridge, Command, Commands } from "./protocol.ts";

export class BridgeError extends Error {
  readonly refusal: string | null;
  constructor(message: string, refusal: string | null) {
    super(message);
    this.refusal = refusal;
  }
}

export const httpBridge: Bridge = {
  async call<C extends Command>(command: C, params: Commands[C]["params"]): Promise<Commands[C]["result"]> {
    const res = await fetch(`/api/${command}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params ?? {}),
    });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new BridgeError(res.ok ? "the answer wasn't JSON" : `${res.status}: ${text}`, null);
    }
    if (!res.ok) throw new BridgeError(data?.error ?? `${res.status}`, data?.refusal ?? null);
    return data;
  },
};
