import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadScenario } from "../src/contract.js";

const GOOD = `
name: item-create-cancel
agent: example_agent
steps:
  - user: "Add a blue notebook with quantity 3"
  - expect_interrupt:
      where: { "payload.hitl.kind": "item_detail" }
      timeout_s: 180
  - respond: { action: cancel }
assert:
  - eventually:
      event: interrupt
      where: { "payload.hitl.kind": "item_detail" }
      schema: schemas/item_detail.json
      schema_path: payload.hitl
  - paired: tool_calls
`;

function write(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aguiar-"));
  const p = join(dir, "s.yaml");
  writeFileSync(p, content);
  return p;
}

describe("loadScenario", () => {
  it("parses a valid scenario and records its directory", () => {
    const p = write(GOOD);
    const s = loadScenario(p);
    expect(s.name).toBe("item-create-cancel");
    expect(s.agent).toBe("example_agent");
    expect(s.steps).toHaveLength(3);
    expect(s.assert).toHaveLength(2);
    expect(s.dir).toBe(join(p, ".."));
  });

  it("rejects a scenario with an unknown step key", () => {
    const p = write(GOOD.replace("respond:", "reply:"));
    expect(() => loadScenario(p)).toThrowError(/unknown step/i);
  });

  it("rejects a scenario missing name or agent", () => {
    const p = write(GOOD.replace("agent: example_agent\n", ""));
    expect(() => loadScenario(p)).toThrowError(/agent/i);
  });

  it("rejects an assertion with an unknown key", () => {
    const p = write(GOOD.replace("paired: tool_calls", "always: something"));
    expect(() => loadScenario(p)).toThrowError(/unknown assertion/i);
  });
});

describe("loadScenario context/headers", () => {
  const WITH_CONTEXT = `
name: ctx
agent: example_agent
steps: [{ user: "hi" }]
assert: []
context:
  store_id: "\${AGUIAR_TEST_STORE}"
  token: "\${AGUIAR_TEST_TOKEN}"
  nested: { locale: "ar", tags: ["\${AGUIAR_TEST_STORE}"] }
headers:
  X-Client-Id: "\${AGUIAR_TEST_STORE}"
`;

  it("parses context/headers and interpolates ${ENV} references", () => {
    process.env.AGUIAR_TEST_STORE = "store-123";
    process.env.AGUIAR_TEST_TOKEN = "tok-abc";
    const s = loadScenario(write(WITH_CONTEXT));
    expect(s.context).toEqual({
      store_id: "store-123",
      token: "tok-abc",
      nested: { locale: "ar", tags: ["store-123"] },
    });
    expect(s.headers).toEqual({ "X-Client-Id": "store-123" });
  });

  it("fails fast when a referenced environment variable is unset", () => {
    delete process.env.AGUIAR_TEST_TOKEN;
    process.env.AGUIAR_TEST_STORE = "store-123";
    expect(() => loadScenario(write(WITH_CONTEXT))).toThrowError(/AGUIAR_TEST_TOKEN.*not set/);
  });

  it("rejects a non-mapping context", () => {
    const p = write(WITH_CONTEXT.replace(/context:[\s\S]*headers:/, "context: [1,2]\nheaders:"));
    process.env.AGUIAR_TEST_STORE = "store-123";
    expect(() => loadScenario(p)).toThrowError(/"context" must be a mapping/);
  });

  it("leaves context undefined when absent", () => {
    expect(loadScenario(write(GOOD)).context).toBeUndefined();
  });
});
