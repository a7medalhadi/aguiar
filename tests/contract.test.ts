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
