import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import type { EventType } from "./events.js";

export interface Predicate {
  event: EventType;
  where?: Record<string, unknown>;
  /** Path to a JSON Schema file, relative to the scenario YAML. */
  schema?: string;
  /** Dot-path into the matched event to validate against the schema (default: whole event). */
  schema_path?: string;
}

export type Assertion =
  | { eventually: Predicate & { count?: number } }
  | { never: Predicate }
  | { paired: "tool_calls" }
  | { survives: { tool_call: string } };

export interface HitlResponseValue {
  action: "submit" | "change" | "cancel";
  value?: unknown;
}

export type Step =
  | { user: string }
  | { expect_interrupt: { where?: Record<string, unknown>; timeout_s?: number } }
  | { respond: HitlResponseValue };

export interface Scenario {
  name: string;
  agent: string;
  steps: Step[];
  assert: Assertion[];
  /** Directory of the YAML file; schema paths resolve against this. */
  dir: string;
}

const STEP_KEYS = new Set(["user", "expect_interrupt", "respond"]);
const ASSERTION_KEYS = new Set(["eventually", "never", "paired", "survives"]);

function soleKey(obj: object, allowed: Set<string>, what: string): string {
  const keys = Object.keys(obj);
  if (keys.length !== 1 || !allowed.has(keys[0])) {
    throw new Error(`unknown ${what} "${keys.join(",")}" — expected one of: ${[...allowed].join(", ")}`);
  }
  return keys[0];
}

export function loadScenario(path: string): Scenario {
  const raw = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (typeof raw?.name !== "string") throw new Error(`${path}: scenario "name" (string) is required`);
  if (typeof raw?.agent !== "string") throw new Error(`${path}: scenario "agent" (string) is required`);
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) throw new Error(`${path}: "steps" must be a non-empty list`);
  if (!Array.isArray(raw.assert)) throw new Error(`${path}: "assert" must be a list`);
  for (const step of raw.steps) soleKey(step as object, STEP_KEYS, "step");
  for (const a of raw.assert) soleKey(a as object, ASSERTION_KEYS, "assertion");
  return {
    name: raw.name,
    agent: raw.agent,
    steps: raw.steps as Step[],
    assert: raw.assert as Assertion[],
    dir: resolve(dirname(path)),
  };
}
