import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
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
  /** Extra fields merged into the run input alongside `messages` — what a
   * production ingress (gateway/runtime) would inject into run state. */
  context?: Record<string, unknown>;
  /** Default HTTP headers for the LangGraph client (e.g. access-proxy creds). */
  headers?: Record<string, string>;
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

/** Replace `${VAR}` references in string values (recursively) with process.env
 * values, so secrets never live in committed scenario YAML. Unset variables are
 * a hard error — failing fast beats sending an empty token. */
function interpolateEnv(value: unknown, where: string): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
      const v = process.env[name];
      if (v === undefined) {
        throw new Error(`${where}: environment variable "${name}" is not set (referenced as \${${name}})`);
      }
      return v;
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolateEnv(v, where));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolateEnv(v, where)]),
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merges `override` onto `base`: plain objects merge key-by-key
 * recursively, everything else (arrays, scalars, null) is replaced wholesale.
 * `override` always wins on conflicts. */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = base[key];
    result[key] = isPlainObject(value) && isPlainObject(baseValue) ? deepMerge(baseValue, value) : value;
  }
  return result;
}

const DEFAULTS_ALLOWED_KEYS = new Set(["agent", "headers", "context"]);

/** Loads and validates a scenario's `extends:` target. A defaults file may
 * only set agent/headers/context (rationale: inheriting `steps` would make a
 * scenario's behavior invisible at its call site) and may not itself extend
 * another file (one level only, no chaining). */
function loadDefaults(scenarioPath: string, extendsValue: unknown): Record<string, unknown> {
  if (typeof extendsValue !== "string") {
    throw new Error(`${scenarioPath}: "extends" must be a string`);
  }
  const defaultsPath = resolve(dirname(scenarioPath), extendsValue);
  let raw: Record<string, unknown>;
  try {
    raw = parse(readFileSync(defaultsPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${scenarioPath}: extends target "${extendsValue}" not found`);
    }
    throw err;
  }
  if (raw.extends !== undefined) {
    throw new Error(`${defaultsPath}: nested "extends" is not supported (one level only)`);
  }
  for (const key of Object.keys(raw)) {
    if (!DEFAULTS_ALLOWED_KEYS.has(key)) {
      throw new Error(
        `${defaultsPath}: a defaults file may only set "agent", "headers", "context" — found "${key}"`,
      );
    }
  }
  return raw;
}

function optionalObject(
  raw: Record<string, unknown>,
  key: "context" | "headers",
  path: string,
): Record<string, unknown> | undefined {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: "${key}" must be a mapping`);
  }
  return interpolateEnv(value, `${path}: ${key}`) as Record<string, unknown>;
}

export function loadScenario(path: string): Scenario {
  const raw = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const merged: Record<string, unknown> =
    raw?.extends !== undefined ? deepMerge(loadDefaults(path, raw.extends), raw) : raw;
  if (typeof merged?.name !== "string") throw new Error(`${path}: scenario "name" (string) is required`);
  if (typeof merged?.agent !== "string") throw new Error(`${path}: scenario "agent" (string) is required`);
  if (!Array.isArray(merged.steps) || merged.steps.length === 0) throw new Error(`${path}: "steps" must be a non-empty list`);
  if (!Array.isArray(merged.assert)) throw new Error(`${path}: "assert" must be a list`);
  for (const step of merged.steps) soleKey(step as object, STEP_KEYS, "step");
  for (const a of merged.assert) soleKey(a as object, ASSERTION_KEYS, "assertion");
  return {
    name: merged.name,
    agent: merged.agent,
    steps: merged.steps as Step[],
    assert: merged.assert as Assertion[],
    dir: resolve(dirname(path)),
    context: optionalObject(merged, "context", path),
    headers: optionalObject(merged, "headers", path) as Record<string, string> | undefined,
  };
}
