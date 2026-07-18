/**
 * The normalized event model — the single representation all contract logic
 * operates on. Transport adapters translate their protocol into this.
 */
export type NormalizedEvent =
  | { type: "run_started"; ts: string }
  | { type: "run_finished"; ts: string }
  | { type: "run_error"; ts: string; message: string }
  | { type: "text_message"; ts: string; id: string; role: "user" | "assistant"; content: string }
  | { type: "tool_call_start"; ts: string; id: string; name: string; args: unknown }
  | { type: "tool_call_end"; ts: string; id: string; result?: unknown }
  | { type: "state_snapshot"; ts: string; state: Record<string, unknown> }
  | { type: "interrupt"; ts: string; payload: unknown }
  | { type: "resume"; ts: string; value: unknown };

export type EventType = NormalizedEvent["type"];

export function now(): string {
  return new Date().toISOString();
}
