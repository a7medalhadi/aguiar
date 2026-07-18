import { describe, expect, it } from "vitest";
import {
  newNormalizerState,
  normalizeChunk,
  type StreamChunk,
} from "../src/adapters/langgraph-normalize.js";

const valuesChunk = (messages: unknown[]): StreamChunk => ({
  event: "values",
  data: { messages },
});

describe("normalizeChunk", () => {
  it("emits interrupt from updates chunks", () => {
    const events = normalizeChunk(
      { event: "updates", data: { __interrupt__: [{ value: { hitl: { kind: "item_detail" } } }] } },
      newNormalizerState(),
    );
    expect(events).toEqual([
      expect.objectContaining({ type: "interrupt", payload: { hitl: { kind: "item_detail" } } }),
    ]);
  });

  it("diffs tool calls out of successive values chunks without duplicates", () => {
    const state = newNormalizerState();
    const ai = { id: "m1", type: "ai", content: "", tool_calls: [{ id: "tc1", name: "preview_item", args: { item_id: 1 } }] };
    const first = normalizeChunk(valuesChunk([ai]), state);
    expect(first.filter((e) => e.type === "tool_call_start")).toHaveLength(1);

    const tool = { id: "m2", type: "tool", tool_call_id: "tc1", content: "ok" };
    const second = normalizeChunk(valuesChunk([ai, tool]), state);
    expect(second.filter((e) => e.type === "tool_call_start")).toHaveLength(0);
    expect(second.filter((e) => e.type === "tool_call_end")).toEqual([
      expect.objectContaining({ id: "tc1", result: "ok" }),
    ]);
  });

  it("emits a state_snapshot for every values chunk", () => {
    const state = newNormalizerState();
    const events = normalizeChunk(valuesChunk([]), state);
    expect(events.filter((e) => e.type === "state_snapshot")).toHaveLength(1);
  });

  it("emits text_message once per new message id", () => {
    const state = newNormalizerState();
    const msg = { id: "m1", type: "ai", content: "hello" };
    expect(normalizeChunk(valuesChunk([msg]), state).filter((e) => e.type === "text_message")).toHaveLength(1);
    expect(normalizeChunk(valuesChunk([msg]), state).filter((e) => e.type === "text_message")).toHaveLength(0);
  });

  it("maps error chunks to run_error and ignores metadata", () => {
    const state = newNormalizerState();
    expect(normalizeChunk({ event: "error", data: { message: "boom" } }, state)).toEqual([
      expect.objectContaining({ type: "run_error", message: "boom" }),
    ]);
    expect(normalizeChunk({ event: "metadata", data: { run_id: "r1" } }, state)).toEqual([]);
  });
});
