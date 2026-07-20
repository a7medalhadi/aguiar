import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { loadScenario } from "../src/contract.js";

const GOOD = `
name: item-create-cancel
agent: example_agent
steps:
  - user: "Add a blue notebook with quantity 3"
  - expect_interrupt:
      where: { "payload.hitl.kind": "item_detail" }
      timeout_s: 180
  - respond: { action: cancel }
assert:
  - eventually:
      event: interrupt
      where: { "payload.hitl.kind": "item_detail" }
      schema: schemas/item_detail.json
      schema_path: payload.hitl
  - paired: tool_calls
`;

function write(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aguiar-"));
  const p = join(dir, "s.yaml");
  writeFileSync(p, content);
  return p;
}

/** Writes a scenario and its defaults file side by side in one fresh temp
 * dir, so `extends: defaults.yaml` resolves. Returns the scenario path. */
function writeWithDefaults(scenario: string, defaults: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aguiar-"));
  writeFileSync(join(dir, "defaults.yaml"), defaults);
  const p = join(dir, "s.yaml");
  writeFileSync(p, scenario);
  return p;
}

/** Writes a scenario and its defaults file in two *different* temp dirs,
 * baking a correct relative `extends:` path into the scenario body.
 * Returns the scenario path. */
function writeWithDefaultsAcrossDirs(scenarioBody: string, defaults: string): string {
  const scenarioDir = mkdtempSync(join(tmpdir(), "aguiar-scenario-"));
  const defaultsDir = mkdtempSync(join(tmpdir(), "aguiar-defaults-"));
  const defaultsPath = join(defaultsDir, "defaults.yaml");
  writeFileSync(defaultsPath, defaults);
  const rel = relative(scenarioDir, defaultsPath);
  const p = join(scenarioDir, "s.yaml");
  writeFileSync(p, `extends: ${rel}\n${scenarioBody}`);
  return p;
}

describe("loadScenario", () => {
  it("parses a valid scenario and records its directory", () => {
    const p = write(GOOD);
    const s = loadScenario(p);
    expect(s.name).toBe("item-create-cancel");
    expect(s.agent).toBe("example_agent");
    expect(s.steps).toHaveLength(3);
    expect(s.assert).toHaveLength(2);
    expect(s.dir).toBe(join(p, ".."));
  });

  it("rejects a scenario with an unknown step key", () => {
    const p = write(GOOD.replace("respond:", "reply:"));
    expect(() => loadScenario(p)).toThrowError(/unknown step/i);
  });

  it("rejects a scenario missing name or agent", () => {
    const p = write(GOOD.replace("agent: example_agent\n", ""));
    expect(() => loadScenario(p)).toThrowError(/agent/i);
  });

  it("rejects an assertion with an unknown key", () => {
    const p = write(GOOD.replace("paired: tool_calls", "always: something"));
    expect(() => loadScenario(p)).toThrowError(/unknown assertion/i);
  });
});

describe("loadScenario context/headers", () => {
  const WITH_CONTEXT = `
name: ctx
agent: example_agent
steps: [{ user: "hi" }]
assert: []
context:
  store_id: "\${AGUIAR_TEST_STORE}"
  token: "\${AGUIAR_TEST_TOKEN}"
  nested: { locale: "ar", tags: ["\${AGUIAR_TEST_STORE}"] }
headers:
  X-Client-Id: "\${AGUIAR_TEST_STORE}"
`;

  it("parses context/headers and interpolates ${ENV} references", () => {
    process.env.AGUIAR_TEST_STORE = "store-123";
    process.env.AGUIAR_TEST_TOKEN = "tok-abc";
    const s = loadScenario(write(WITH_CONTEXT));
    expect(s.context).toEqual({
      store_id: "store-123",
      token: "tok-abc",
      nested: { locale: "ar", tags: ["store-123"] },
    });
    expect(s.headers).toEqual({ "X-Client-Id": "store-123" });
  });

  it("fails fast when a referenced environment variable is unset", () => {
    delete process.env.AGUIAR_TEST_TOKEN;
    process.env.AGUIAR_TEST_STORE = "store-123";
    expect(() => loadScenario(write(WITH_CONTEXT))).toThrowError(/AGUIAR_TEST_TOKEN.*not set/);
  });

  it("rejects a non-mapping context", () => {
    const p = write(WITH_CONTEXT.replace(/context:[\s\S]*headers:/, "context: [1,2]\nheaders:"));
    process.env.AGUIAR_TEST_STORE = "store-123";
    expect(() => loadScenario(p)).toThrowError(/"context" must be a mapping/);
  });

  it("leaves context undefined when absent", () => {
    expect(loadScenario(write(GOOD)).context).toBeUndefined();
  });
});

describe("loadScenario with extends", () => {
  const MINIMAL_STEPS = `steps: [{ user: "hi" }]\nassert: []\n`;

  it("inherits agent, headers, and context from the defaults file", () => {
    const p = writeWithDefaults(
      `extends: defaults.yaml\nname: inherits-all\n${MINIMAL_STEPS}`,
      `agent: from_defaults_agent\nheaders:\n  X-Client-Id: static-value\ncontext:\n  store_id: static-store\n`,
    );
    const s = loadScenario(p);
    expect(s.agent).toBe("from_defaults_agent");
    expect(s.headers).toEqual({ "X-Client-Id": "static-value" });
    expect(s.context).toEqual({ store_id: "static-store" });
  });

  it("scenario value wins over defaults on a scalar conflict", () => {
    const p = writeWithDefaults(
      `extends: defaults.yaml\nname: scalar-wins\nagent: from_scenario\n${MINIMAL_STEPS}`,
      `agent: from_defaults\nheaders:\n  X-Defaults-Only: static-value\n`,
    );
    const s = loadScenario(p);
    expect(s.agent).toBe("from_scenario");
    // A defaults-only sibling that the scenario never mentions must still
    // arrive — proving the merge actually ran, not just that the scenario's
    // own inline `agent` was read.
    expect(s.headers).toEqual({ "X-Defaults-Only": "static-value" });
  });

  it("deep-merges context, keeping sibling keys not overridden by the scenario", () => {
    const p = writeWithDefaults(
      `extends: defaults.yaml\nname: deep-merge\nagent: a\n${MINIMAL_STEPS}context:\n  core:\n    store_id: s2\n`,
      `agent: a\ncontext:\n  core:\n    user_id: u1\n    store_id: s1\n    token: t1\n`,
    );
    const s = loadScenario(p);
    expect(s.context).toEqual({ core: { user_id: "u1", store_id: "s2", token: "t1" } });
  });

  it("replaces arrays wholesale instead of concatenating them", () => {
    const p = writeWithDefaults(
      `extends: defaults.yaml\nname: array-replace\nagent: a\n${MINIMAL_STEPS}context:\n  tags: ["s1"]\n`,
      `agent: a\ncontext:\n  tags: ["d1", "d2"]\n  core:\n    token: t1\n`,
    );
    const s = loadScenario(p);
    // `tags` proves wholesale replacement; `core.token` is a defaults-only
    // sibling the scenario never sets, proving the merge actually ran.
    expect(s.context).toEqual({ tags: ["s1"], core: { token: "t1" } });
  });

  it("interpolates ${ENV} references in values inherited from the defaults file", () => {
    process.env.AGUIAR_TEST_EXTENDS_VAR = "val-from-env";
    try {
      const p = writeWithDefaults(
        `extends: defaults.yaml\nname: interpolate-inherited\nagent: a\n${MINIMAL_STEPS}`,
        `agent: a\ncontext:\n  token: "\${AGUIAR_TEST_EXTENDS_VAR}"\n`,
      );
      const s = loadScenario(p);
      expect(s.context).toEqual({ token: "val-from-env" });
    } finally {
      delete process.env.AGUIAR_TEST_EXTENDS_VAR;
    }
  });

  it("still hard-errors on an unset ${ENV} reference inherited from the defaults file", () => {
    delete process.env.AGUIAR_TEST_EXTENDS_VAR;
    const p = writeWithDefaults(
      `extends: defaults.yaml\nname: unset-inherited\nagent: a\n${MINIMAL_STEPS}`,
      `agent: a\ncontext:\n  token: "\${AGUIAR_TEST_EXTENDS_VAR}"\n`,
    );
    expect(() => loadScenario(p)).toThrowError(/AGUIAR_TEST_EXTENDS_VAR.*not set/);
  });

  it("throws naming the path when the extends target is missing", () => {
    const p = write(`extends: nonexistent.yaml\nname: missing-defaults\nagent: a\n${MINIMAL_STEPS}`);
    expect(() => loadScenario(p)).toThrowError(/extends target "nonexistent\.yaml" not found/);
  });

  it("throws naming the offending key when the defaults file sets steps", () => {
    const p = writeWithDefaults(
      `extends: defaults.yaml\nname: defaults-with-steps\nagent: a\n${MINIMAL_STEPS}`,
      `agent: a\nsteps: [{ user: "hi" }]\n`,
    );
    expect(() => loadScenario(p)).toThrowError(/"steps"/);
  });

  it("throws when the defaults file itself has a nested extends", () => {
    const p = writeWithDefaults(
      `extends: defaults.yaml\nname: nested-extends\nagent: a\n${MINIMAL_STEPS}`,
      `agent: a\nextends: other.yaml\n`,
    );
    expect(() => loadScenario(p)).toThrowError(/nested "extends" is not supported/);
  });

  it("keeps dir pointing at the scenario's own directory when defaults live elsewhere", () => {
    const p = writeWithDefaultsAcrossDirs(
      `name: cross-dir\nagent: a\n${MINIMAL_STEPS}`,
      `agent: a\ncontext:\n  store_id: from-defaults\n`,
    );
    const s = loadScenario(p);
    expect(s.dir).toBe(dirname(p));
    // A defaults-only field must still arrive across the cross-dir extends,
    // proving the merge ran rather than `dir` merely being correct because
    // the scenario was self-sufficient.
    expect(s.context).toEqual({ store_id: "from-defaults" });
  });

  it("regression: a scenario without extends still loads unchanged", () => {
    const s = loadScenario(write(GOOD));
    expect(s.name).toBe("item-create-cancel");
    expect(s.agent).toBe("example_agent");
    expect(s.steps).toHaveLength(3);
    expect(s.assert).toHaveLength(2);
  });
});
