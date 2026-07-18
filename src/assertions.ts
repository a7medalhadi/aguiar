import type { NormalizedEvent } from "./events.js";
import type { Assertion, Predicate } from "./contract.js";
import { matchesPredicate, validateShape } from "./match.js";

export interface Violation {
  assertion: string;
  message: string;
}

function describePredicate(p: Predicate): string {
  const where = p.where ? ` where ${JSON.stringify(p.where)}` : "";
  return `${p.event}${where}`;
}

function deepContainsString(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value === needle;
  if (Array.isArray(value)) return value.some((v) => deepContainsString(v, needle));
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((v) => deepContainsString(v, needle));
  }
  return false;
}

export function checkAssertion(a: Assertion, trace: NormalizedEvent[], dir: string): Violation[] {
  if ("eventually" in a) {
    const p = a.eventually;
    const need = p.count ?? 1;
    const matches = trace.filter((e) => matchesPredicate(e, p));
    const violations: Violation[] = [];
    if (matches.length < need) {
      violations.push({
        assertion: "eventually",
        message: `expected ${need} event(s) matching ${describePredicate(p)}, saw ${matches.length} of ${need}`,
      });
    }
    for (const event of matches) {
      for (const err of validateShape(event, p, dir)) {
        violations.push({ assertion: "eventually", message: `shape violation: ${err}` });
      }
    }
    return violations;
  }

  if ("never" in a) {
    const p = a.never;
    const idx = trace.findIndex((e) => matchesPredicate(e, p));
    if (idx === -1) return [];
    return [{
      assertion: "never",
      message: `forbidden event matching ${describePredicate(p)} occurred at trace index ${idx}`,
    }];
  }

  if ("paired" in a) {
    const starts = new Map<string, string>();
    const ends = new Set<string>();
    for (const e of trace) {
      if (e.type === "tool_call_start") starts.set(e.id, e.name);
      if (e.type === "tool_call_end") ends.add(e.id);
    }
    return [...starts.entries()]
      .filter(([id]) => !ends.has(id))
      .map(([id, name]) => ({
        assertion: "paired",
        message: `tool call ${name} (${id}) started but never ended`,
      }));
  }

  // survives
  const { tool_call } = a.survives;
  const ids = trace
    .filter((e): e is Extract<NormalizedEvent, { type: "tool_call_start" }> => e.type === "tool_call_start")
    .filter((e) => e.name === tool_call)
    .map((e) => e.id);
  if (ids.length === 0) {
    return [{ assertion: "survives", message: `no tool call named ${tool_call} ever started` }];
  }
  const snapshots = trace.filter(
    (e): e is Extract<NormalizedEvent, { type: "state_snapshot" }> => e.type === "state_snapshot",
  );
  if (snapshots.length === 0) {
    return [{ assertion: "survives", message: `no state_snapshot in trace to check ${tool_call} against` }];
  }
  const final = snapshots[snapshots.length - 1];
  if (ids.some((id) => deepContainsString(final.state, id))) return [];
  return [{
    assertion: "survives",
    message: `tool call ${tool_call} (${ids.join(", ")}) is missing from the final state snapshot — it will vanish from the UI when the run ends`,
  }];
}
