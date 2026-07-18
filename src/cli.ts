#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { Command, CommanderError } from "commander";
import { Client } from "@langchain/langgraph-sdk";
import { loadScenario } from "./contract.js";
import { formatReport, lintTrace } from "./lint.js";
import { writeTrace } from "./trace.js";
import { recordScenario, type LangGraphClientLike } from "./adapters/langgraph.js";

export const program = new Command();

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

program.name("aguiar").description("Contract testing for agent event streams").version(version);

// Throw a CommanderError instead of calling process.exit() directly, so we can
// map commander's own exit codes onto aguiar's convention: usage errors (missing
// args, unknown command/option) exit 2 — distinct from "contract violated" (1) —
// while help/version output still exits 0. Must run before `.command(...)` below
// so subcommands inherit the callback via Command#copyInheritedSettings.
program.exitOverride();

program
  .command("lint")
  .description("Validate a recorded trace against a scenario's contract")
  .argument("<trace>", "JSONL trace file")
  .argument("<scenario>", "scenario YAML file")
  .action((trace: string, scenario: string) => {
    const report = lintTrace(trace, scenario);
    console.log(formatReport(report));
    process.exitCode = report.passed ? 0 : 1;
  });

async function doRecord(scenarioPath: string, opts: { url: string; out?: string }): Promise<string> {
  const scenario = loadScenario(scenarioPath);
  const client = new Client({
    apiUrl: opts.url,
    defaultHeaders: scenario.headers,
  }) as unknown as LangGraphClientLike;
  const events = await recordScenario(client, scenario);
  const out = opts.out ?? join("traces", `${scenario.name}-${Date.now()}.jsonl`);
  mkdirSync(dirname(out), { recursive: true });
  writeTrace(out, events);
  console.log(`recorded ${events.length} events → ${out}`);
  return out;
}

program
  .command("record")
  .description("Drive the agent through a scenario and record a normalized trace")
  .argument("<scenario>", "scenario YAML file")
  .option("--url <url>", "LangGraph server URL", "http://localhost:2024")
  .option("--out <file>", "output trace path (default: traces/<name>-<ts>.jsonl)")
  .action(async (scenario: string, opts: { url: string; out?: string }) => {
    await doRecord(scenario, opts);
  });

program
  .command("check")
  .description("record + lint in one step (CI mode)")
  .argument("<scenario>", "scenario YAML file")
  .option("--url <url>", "LangGraph server URL", "http://localhost:2024")
  .option("--out <file>", "output trace path")
  .action(async (scenarioPath: string, opts: { url: string; out?: string }) => {
    const tracePath = await doRecord(scenarioPath, opts);
    const report = lintTrace(tracePath, scenarioPath);
    console.log(formatReport(report));
    process.exitCode = report.passed ? 0 : 1;
  });

const invokedDirectly = process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("aguiar");
if (invokedDirectly) {
  program.parseAsync().catch((err) => {
    if (err instanceof CommanderError) {
      // commander.helpDisplayed / commander.version are not failures.
      const isHelpOrVersion = err.code === "commander.helpDisplayed" || err.code === "commander.version";
      process.exitCode = isHelpOrVersion ? 0 : 2;
      return;
    }
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 2;
  });
}
