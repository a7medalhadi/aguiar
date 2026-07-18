import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedEvent } from "../src/events.js";
import { getPath, matchesPredicate, validateShape } from "../src/match.js";

const interrupt: NormalizedEvent = {
  type: "interrupt",
  ts: "2026-07-18T00:00:00Z",
  payload: { hitl: { kind: "item_detail", id: "item-detail", item: { name: "notebook", quantity: 3 } } },
};

describe("getPath", () => {
  it("walks dot paths", () => {
    expect(getPath(interrupt, "payload.hitl.kind")).toBe("item_detail");
    expect(getPath(interrupt, "payload.hitl.missing")).toBeUndefined();
  });
});

describe("matchesPredicate", () => {
  it("matches on event type and where clauses", () => {
    expect(matchesPredicate(interrupt, { event: "interrupt", where: { "payload.hitl.kind": "item_detail" } })).toBe(true);
    expect(matchesPredicate(interrupt, { event: "interrupt", where: { "payload.hitl.kind": "item_update" } })).toBe(false);
    expect(matchesPredicate(interrupt, { event: "tool_call_start" })).toBe(false);
  });
});

describe("validateShape", () => {
  function contractDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "aguiar-"));
    mkdirSync(join(dir, "schemas"));
    writeFileSync(
      join(dir, "schemas", "item_detail.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["kind", "id", "item"],
        properties: {
          kind: { const: "item_detail" },
          id: { type: "string" },
          item: {
            type: "object",
            required: ["name", "quantity"],
            properties: { name: { type: "string" }, quantity: { type: "number" } },
          },
        },
      }),
    );
    return dir;
  }

  const predicate = {
    event: "interrupt" as const,
    schema: "schemas/item_detail.json",
    schema_path: "payload.hitl",
  };

  it("passes a conforming payload", () => {
    expect(validateShape(interrupt, predicate, contractDir())).toEqual([]);
  });

  it("reports errors for a violating payload", () => {
    const bad: NormalizedEvent = {
      type: "interrupt",
      ts: "2026-07-18T00:00:00Z",
      payload: { hitl: { kind: "item_detail", id: "item-detail", item: { name: "notebook", quantity: "3" } } },
    };
    const errors = validateShape(bad, predicate, contractDir());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toMatch(/quantity/);
  });

  it("validates prefixItems from draft 2020-12", () => {
    const dir = mkdtempSync(join(tmpdir(), "aguiar-"));
    mkdirSync(join(dir, "schemas"));
    writeFileSync(
      join(dir, "schemas", "typed_array.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "array",
        prefixItems: [{ type: "string" }, { type: "number" }],
      }),
    );

    const event: NormalizedEvent = {
      type: "interrupt",
      ts: "2026-07-18T00:00:00Z",
      payload: { data: ["x", "not-a-number"] },
    };

    const predicate = {
      event: "interrupt" as const,
      schema: "schemas/typed_array.json",
      schema_path: "payload.data",
    };

    const errors = validateShape(event, predicate, dir);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toMatch(/number|type/);
  });
});
