import { describe, expect, it } from "vitest";
import { recordScenario, type LangGraphClientLike } from "../src/adapters/langgraph.js";
import type { Scenario } from "../src/contract.js";
import type { StreamChunk } from "../src/adapters/langgraph-normalize.js";

function fakeClient(turns: StreamChunk[][]): { client: LangGraphClientLike; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  let turn = 0;
  return {
    calls,
    client: {
      threads: { create: async () => ({ thread_id: "t1" }) },
      runs: {
        stream(_thread, _agent, payload) {
          calls.push(payload);
          const chunks = turns[turn++] ?? [];
          return (async function* () { yield* chunks; })();
        },
      },
    },
  };
}

const scenario: Scenario = {
  name: "create-cancel",
  agent: "example_agent",
  dir: "/tmp",
  steps: [
    { user: "Add a notebook" },
    { expect_interrupt: { where: { "payload.hitl.kind": "item_detail" } } },
    { respond: { action: "cancel" } },
  ],
  assert: [],
};

const interruptChunk: StreamChunk = {
  event: "updates",
  data: { __interrupt__: [{ value: { hitl: { kind: "item_detail", id: "item-detail" } } }] },
};

describe("recordScenario", () => {
  it("drives user → interrupt → resume and records the full trace", async () => {
    const { client, calls } = fakeClient([
      [{ event: "values", data: { messages: [] } }, interruptChunk],
      [{ event: "values", data: { messages: [] } }],
    ]);
    const events = await recordScenario(client, scenario);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run_started");
    expect(types.at(-1)).toBe("run_finished");
    expect(types).toContain("interrupt");
    expect(types).toContain("resume");
    expect(calls[0]).toHaveProperty("input");
    expect(calls[1]).toEqual(expect.objectContaining({ command: { resume: { action: "cancel" } } }));
  });

  it("stops early with a warning when the expected interrupt never arrives", async () => {
    const { client, calls } = fakeClient([[{ event: "values", data: { messages: [] } }]]);
    const events = await recordScenario(client, scenario);
    expect(events.map((e) => e.type)).not.toContain("resume");
    expect(events.at(-1)?.type).toBe("run_finished");
    expect(calls).toHaveLength(1); // respond step never ran
  });
});

// A scenario with two chained expect_interrupt/respond pairs and no second `user`
// step in between — models a resume that may (or may not) raise another HITL
// interrupt directly. This is the shape that exposed the stale-interrupt bug:
// without a watermark, the second expect_interrupt could be satisfied by the
// FIRST turn's interrupt still sitting in `events`, even when the resume's own
// stream never produced a new one.
const twoInterruptScenario: Scenario = {
  name: "double-interrupt",
  agent: "example_agent",
  dir: "/tmp",
  steps: [
    { user: "Add a notebook and a pen" },
    { expect_interrupt: { where: { "payload.hitl.kind": "item_detail" } } },
    { respond: { action: "submit" } },
    { expect_interrupt: { where: { "payload.hitl.kind": "item_detail" } } },
    { respond: { action: "submit" } },
  ],
  assert: [],
};

describe("recordScenario — chained expect_interrupt watermark", () => {
  it("does not let a second expect_interrupt match the first turn's stale interrupt", async () => {
    const { client, calls } = fakeClient([
      [{ event: "values", data: { messages: [] } }, interruptChunk], // turn 1: interrupts
      [{ event: "values", data: { messages: [] } }], // turn 1's resume: does NOT re-interrupt
    ]);
    const events = await recordScenario(client, twoInterruptScenario);
    expect(calls).toHaveLength(2); // second respond never ran — early stop
    expect(events.filter((e) => e.type === "resume")).toHaveLength(1);
    expect(events.filter((e) => e.type === "interrupt")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("run_finished");
  });

  it("completes all steps when the resume genuinely re-interrupts", async () => {
    const { client, calls } = fakeClient([
      [{ event: "values", data: { messages: [] } }, interruptChunk], // turn 1: interrupts
      [{ event: "values", data: { messages: [] } }, interruptChunk], // turn 1's resume: re-interrupts
      [{ event: "values", data: { messages: [] } }], // turn 2's resume: completes
    ]);
    const events = await recordScenario(client, twoInterruptScenario);
    expect(calls).toHaveLength(3);
    expect(events.filter((e) => e.type === "resume")).toHaveLength(2);
    expect(events.filter((e) => e.type === "interrupt")).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("run_finished");
  });
});

describe("recordScenario context injection", () => {
  it("merges scenario.context into every user turn's run input", async () => {
    const { client, calls } = fakeClient([
      [{ event: "values", data: { messages: [] } }, interruptChunk],
      [{ event: "values", data: { messages: [] } }],
    ]);
    const withContext: Scenario = {
      ...scenario,
      context: { store_id: "store-123", token: "tok-abc" },
    };
    await recordScenario(client, withContext);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          store_id: "store-123",
          token: "tok-abc",
          messages: [{ type: "human", content: "Add a notebook" }],
        }),
      }),
    );
    // resume turns carry the command, not a fresh input
    expect(calls[1]).not.toHaveProperty("input");
  });
});
