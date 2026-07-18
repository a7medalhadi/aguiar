import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { checkAssertion } from "../src/assertions.js";
import { readTrace } from "../src/trace.js";
import type { Assertion } from "../src/contract.js";

const __dirname = new URL(".", import.meta.url).pathname;
const FIXTURES = join(__dirname, "fixtures");
const load = (name: string) => readTrace(join(FIXTURES, name));

const expectInterrupt: Assertion = {
  eventually: { event: "interrupt", where: { "payload.hitl.kind": "item_detail" } },
};
const previewSurvives: Assertion = { survives: { tool_call: "preview_item" } };
const paired: Assertion = { paired: "tool_calls" };

describe("checkAssertion", () => {
  it("flags the missing-interrupt bug via eventually", () => {
    const v = checkAssertion(expectInterrupt, load("missing-interrupt.jsonl"), FIXTURES);
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/interrupt/);
  });

  it("flags the vanishing-preview bug via survives", () => {
    const v = checkAssertion(previewSurvives, load("vanishing-preview.jsonl"), FIXTURES);
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/preview_item/);
  });

  it("passes all four assertions on a healthy run", () => {
    const trace = load("healthy-run.jsonl");
    for (const a of [expectInterrupt, previewSurvives, paired,
      { never: { event: "tool_call_start", where: { name: "create_item" } } } as Assertion]) {
      expect(checkAssertion(a, trace, FIXTURES)).toEqual([]);
    }
  });

  it("counts repeated matches for eventually (re-present flow)", () => {
    const trace = load("healthy-run.jsonl");
    const twice: Assertion = {
      eventually: { event: "interrupt", where: { "payload.hitl.kind": "item_detail" }, count: 2 },
    };
    const v = checkAssertion(twice, trace, FIXTURES);
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/1 of 2/);
  });

  it("flags dangling tool calls via paired", () => {
    const trace = load("healthy-run.jsonl").filter(
      (e) => e.type !== "tool_call_end",
    );
    const v = checkAssertion(paired, trace, FIXTURES);
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/tc-preview-1/);
  });

  it("flags a matching never event", () => {
    const v = checkAssertion(
      { never: { event: "tool_call_start", where: { name: "preview_item" } } },
      load("healthy-run.jsonl"),
      FIXTURES,
    );
    expect(v).toHaveLength(1);
  });
});
