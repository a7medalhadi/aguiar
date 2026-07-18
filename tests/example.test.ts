import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintTrace } from "../src/lint.js";
import { validateShape } from "../src/match.js";
import type { NormalizedEvent } from "../src/events.js";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const EXAMPLES = join(__dirname, "..", "examples");
const FIXTURES = join(__dirname, "fixtures");
const cancelScenario = join(EXAMPLES, "scenarios", "item-create-cancel.yaml");

describe("example contract", () => {
  it("accepts a conforming item payload", () => {
    const event: NormalizedEvent = {
      type: "interrupt",
      ts: "2026-07-18T00:00:00Z",
      payload: {
        hitl: {
          kind: "item_detail",
          id: "item-detail",
          title: "Item details",
          submitLabel: "Add item",
          cancelLabel: "Cancel",
          item: {
            name: "blue notebook",
            quantity: 3,
            description: "A5 ruled notebook",
            tags: ["blue", "notebook"],
            priority: "normal",
          },
        },
      },
    };
    const errors = validateShape(
      event,
      { event: "interrupt", schema: "schemas/item_detail.json", schema_path: "payload.hitl" },
      EXAMPLES,
    );
    expect(errors).toEqual([]);
  });

  it("rejects a string quantity (shape drift)", () => {
    const event: NormalizedEvent = {
      type: "interrupt",
      ts: "2026-07-18T00:00:00Z",
      payload: { hitl: { kind: "item_detail", id: "item-detail", item: { name: "notebook", quantity: "3" } } },
    };
    const errors = validateShape(
      event,
      { event: "interrupt", schema: "schemas/item_detail.json", schema_path: "payload.hitl" },
      EXAMPLES,
    );
    expect(errors.join(" ")).toMatch(/quantity/);
  });

  it("fails the missing-interrupt fixture against the cancel scenario", () => {
    const report = lintTrace(join(FIXTURES, "missing-interrupt.jsonl"), cancelScenario);
    expect(report.passed).toBe(false);
    expect(report.results.find((r) => r.assertion === "eventually")?.violations.length).toBeGreaterThan(0);
  });
});
