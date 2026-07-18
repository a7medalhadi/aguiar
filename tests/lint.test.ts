import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatReport, lintTrace } from "../src/lint.js";

const SCENARIO = `
name: preview-check
agent: example_agent
steps:
  - user: "Show me the item"
assert:
  - eventually: { event: interrupt, where: { "payload.hitl.kind": "item_detail" } }
  - survives: { tool_call: preview_item }
  - paired: tool_calls
`;

function setup(fixture: string): { trace: string; scenario: string } {
  const dir = mkdtempSync(join(tmpdir(), "aguiar-"));
  const trace = join(dir, "run.jsonl");
  cpSync(join(fileURLToPath(import.meta.url), "..", "fixtures", fixture), trace);
  const scenario = join(dir, "scenario.yaml");
  writeFileSync(scenario, SCENARIO);
  return { trace, scenario };
}

describe("lintTrace", () => {
  it("fails the vanishing-preview trace and names the assertion", () => {
    const { trace, scenario } = setup("vanishing-preview.jsonl");
    const report = lintTrace(trace, scenario);
    expect(report.passed).toBe(false);
    const failed = report.results.filter((r) => r.violations.length > 0);
    expect(failed.map((f) => f.assertion).sort()).toEqual(["eventually", "survives"]);
    expect(formatReport(report)).toMatch(/FAIL.*survives/);
    expect(formatReport(report)).toMatch(/PASS.*paired/);
  });

  it("passes the healthy trace", () => {
    const { trace, scenario } = setup("healthy-run.jsonl");
    const report = lintTrace(trace, scenario);
    expect(report.passed).toBe(true);
  });
});
