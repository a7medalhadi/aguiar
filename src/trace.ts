import { readFileSync, writeFileSync } from "node:fs";
import type { NormalizedEvent } from "./events.js";

export function writeTrace(path: string, events: NormalizedEvent[]): void {
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

export function readTrace(path: string): NormalizedEvent[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const events: NormalizedEvent[] = [];
  lines.forEach((line: string, i: number) => {
    if (line.trim() === "") return;
    try {
      events.push(JSON.parse(line) as NormalizedEvent);
    } catch {
      throw new Error(`${path}:${i + 1}: invalid JSON in trace`);
    }
  });
  return events;
}
