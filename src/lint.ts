import { loadScenario, type Assertion } from "./contract.js";
import { checkAssertion, type Violation } from "./assertions.js";
import { readTrace } from "./trace.js";

export interface LintReport {
  scenario: string;
  trace: string;
  results: { assertion: string; violations: Violation[] }[];
  passed: boolean;
}

function label(a: Assertion): string {
  return Object.keys(a)[0];
}

export function lintTrace(tracePath: string, scenarioPath: string): LintReport {
  const scenario = loadScenario(scenarioPath);
  const trace = readTrace(tracePath);
  const results = scenario.assert.map((a) => ({
    assertion: label(a),
    violations: checkAssertion(a, trace, scenario.dir),
  }));
  return {
    scenario: scenario.name,
    trace: tracePath,
    results,
    passed: results.every((r) => r.violations.length === 0),
  };
}

export function formatReport(r: LintReport): string {
  const lines = [`contract check: ${r.scenario} — ${r.trace}`];
  for (const res of r.results) {
    if (res.violations.length === 0) {
      lines.push(`  PASS  ${res.assertion}`);
    } else {
      lines.push(`  FAIL  ${res.assertion}`);
      for (const v of res.violations) lines.push(`        - ${v.message}`);
    }
  }
  lines.push(r.passed ? "PASSED" : "FAILED");
  return lines.join("\n");
}
