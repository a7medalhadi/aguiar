import { now, type NormalizedEvent } from "../events.js";

export interface StreamChunk {
  event: string;
  data: unknown;
}

export interface NormalizerState {
  toolCallStarts: Set<string>;
  toolCallEnds: Set<string>;
  messageIds: Set<string>;
}

export function newNormalizerState(): NormalizerState {
  return { toolCallStarts: new Set(), toolCallEnds: new Set(), messageIds: new Set() };
}

interface RawMessage {
  id?: string;
  type?: string;
  content?: unknown;
  tool_calls?: { id?: string; name?: string; args?: unknown }[];
  tool_call_id?: string;
}

export function normalizeChunk(chunk: StreamChunk, state: NormalizerState): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  const data = chunk.data as Record<string, unknown> | undefined;

  if (chunk.event === "error") {
    const message = String((data as { message?: unknown } | undefined)?.message ?? JSON.stringify(chunk.data));
    return [{ type: "run_error", ts: now(), message }];
  }

  if (chunk.event === "updates" && data && "__interrupt__" in data) {
    const raw = data.__interrupt__;
    const payload = Array.isArray(raw) && raw[0] && typeof raw[0] === "object" && "value" in (raw[0] as object)
      ? (raw[0] as { value: unknown }).value
      : raw;
    return [{ type: "interrupt", ts: now(), payload }];
  }

  if (chunk.event === "values" && data) {
    const messages = Array.isArray(data.messages) ? (data.messages as RawMessage[]) : [];
    for (const msg of messages) {
      const role = msg.type === "ai" ? "assistant" : msg.type === "human" ? "user" : undefined;
      if (role && msg.id && typeof msg.content === "string" && msg.content !== "" && !state.messageIds.has(msg.id)) {
        state.messageIds.add(msg.id);
        out.push({ type: "text_message", ts: now(), id: msg.id, role, content: msg.content });
      }
      for (const tc of msg.tool_calls ?? []) {
        if (tc.id && !state.toolCallStarts.has(tc.id)) {
          state.toolCallStarts.add(tc.id);
          out.push({ type: "tool_call_start", ts: now(), id: tc.id, name: tc.name ?? "unknown", args: tc.args });
        }
      }
      if (msg.type === "tool" && msg.tool_call_id && !state.toolCallEnds.has(msg.tool_call_id)) {
        state.toolCallEnds.add(msg.tool_call_id);
        out.push({ type: "tool_call_end", ts: now(), id: msg.tool_call_id, result: msg.content });
      }
    }
    out.push({ type: "state_snapshot", ts: now(), state: data });
    return out;
  }

  return [];
}
