import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { NormalizedEvent } from "./events.js";
import type { Predicate } from "./contract.js";

// ajv v8 is CJS; under NodeNext ESM the class may sit on .default.
const Ajv2020 = (Ajv2020Import as unknown as { default?: typeof Ajv2020Import }).default ?? Ajv2020Import;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
(addFormats as unknown as (a: unknown) => void)(ajv);

const compiled = new Map<string, ReturnType<typeof ajv.compile>>();

export function getPath(obj: unknown, dotPath: string): unknown {
  let cur: unknown = obj;
  for (const part of dotPath.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function matchesPredicate(event: NormalizedEvent, p: Predicate): boolean {
  if (event.type !== p.event) return false;
  for (const [path, expected] of Object.entries(p.where ?? {})) {
    const actual = getPath(event, path);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
  }
  return true;
}

export function validateShape(event: NormalizedEvent, p: Predicate, dir: string): string[] {
  if (!p.schema) return [];
  const schemaPath = resolve(dir, p.schema);
  let validate = compiled.get(schemaPath);
  if (!validate) {
    validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
    compiled.set(schemaPath, validate);
  }
  const value = p.schema_path ? getPath(event, p.schema_path) : event;
  if (validate(value)) return [];
  return (validate.errors ?? []).map(
    (e: unknown) => {
      const error = e as { instancePath?: string; message?: string };
      return `${p.schema}${error.instancePath || "/"}: ${error.message ?? "invalid"}`;
    },
  );
}
