import { describe, expect, it } from "vitest";
import { mkdtempSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedEvent } from "../src/events.js";
import { readTrace, writeTrace } from "../src/trace.js";

const events: NormalizedEvent[] = [
  { type: "run_started", ts: "2026-07-18T00:00:00Z" },
  { type: "interrupt", ts: "2026-07-18T00:00:01Z", payload: { hitl: { kind: "item_detail", id: "item-detail" } } },
  { type: "run_finished", ts: "2026-07-18T00:00:02Z" },
];

describe("trace I/O", () => {
  it("round-trips events through JSONL", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aguiar-")), "t.jsonl");
    writeTrace(path, events);
    expect(readTrace(path)).toEqual(events);
  });

  it("reports the offending line on corrupt JSONL", () => {
    const path = join(mkdtempSync(join(tmpdir(), "aguiar-")), "bad.jsonl");
    writeTrace(path, events);
    appendFileSync(path, "{not json\n");
    expect(() => readTrace(path)).toThrowError(/bad\.jsonl:4/);
  });
});
