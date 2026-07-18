# aguiar — AG-UI Assertion Runner

Contract testing for agent event streams. **aguiar** (**AG-UI** **A**ssertion
**R**unner) is Pact-style contract testing adapted to nondeterministic LLM agent
streams: it plays a scripted user conversation against a real agent, records the
normalized event stream, and checks it against a YAML contract of shape and
behavior assertions. v1 speaks to LangGraph agents directly; an [AG-UI](https://ag-ui.com)
transport adapter is on the roadmap, making the contract engine protocol-agnostic.
The three CLI verbs are:

- `aguiar record <scenario>` — connect to the agent, drive the scenario (playing the
  user's side of any human-in-the-loop turns), and write a JSONL trace. Options:
  `--url <url>` (LangGraph server, default `http://localhost:2024`), `--out <file>`
  (output trace path; default `traces/<name>-<timestamp>.jsonl`).
- `aguiar lint <trace> <scenario>` — validate an existing trace against a scenario's
  contract, with no agent connection needed.
- `aguiar check <scenario>` — `record` + `lint` in one step, CI-friendly exit codes
  (0 = pass, 1 = contract violation, 2 = usage or I/O error). Options: `--url <url>`,
  `--out <file>`.

## Install

No clone, no build — install the prebuilt CLI from the latest GitHub release
(requires Node ≥ 20):

```bash
npm install -g https://github.com/a7medalhadi/aguiar/releases/download/v0.1.0/aguiar-0.1.0.tgz
aguiar --help
```

Or run it one-off without installing anything:

```bash
npx https://github.com/a7medalhadi/aguiar/releases/download/v0.1.0/aguiar-0.1.0.tgz --help
```

To add it to a project instead (e.g. as a devDependency for CI), a git spec also
works: `npm install -D github:a7medalhadi/aguiar` (builds on install; note that
*global* installs from a git spec hit a known npm limitation — use the release
tarball above for `-g`). npm registry publication (`npx aguiar …`) is planned —
see the project backlog.

## Quickstart

With the global install, from your agent's repo (scenario files live wherever
you keep them — they're plain YAML + JSON Schema):

```bash
aguiar check path/to/scenario.yaml --url http://localhost:2024
```

Or from a clone of this repo, using the bundled example contract:

```bash
pnpm install && pnpm build
node dist/cli.js check examples/scenarios/item-create-cancel.yaml --url http://localhost:2024
```

This requires a LangGraph dev server running on `:2024` — start one with
`langgraph dev` from your agent's project.

**Verified against a live agent on 2026-07-18:** `aguiar check` (installed from
the v0.1.0 release tarball) ran a smoke scenario — one user turn, asserting
`eventually` an assistant `text_message`, `never` a `run_error`, and `paired`
tool calls — against a real multi-agent LangGraph app served by `langgraph dev`
on `:2024`. Result: 9 events recorded, all three assertions **PASSED**, exit 0.
Interrupt/HITL scenarios run the same engine and are exercised against private
deployments; the bundled `examples/` scenarios require an agent exposing an
`example_agent` graph.

## Contract authoring

A scenario is a YAML file with two parts: a scripted conversation (`steps`) and a
list of invariants to check against the resulting trace (`assert`).

### Steps

Each step is exactly one of:

- `user: "<text>"` — send a message as the user.
- `expect_interrupt: { where?: ..., timeout_s?: ... }` — wait for an `interrupt`
  event, optionally filtered by field. `timeout_s` is parsed but **not enforced in
  v1** (no timeout behavior yet — reserved for a future release).
- `respond: { action: submit | change | cancel, value?: ... }` — resume the
  interrupted run with a HITL response (shape documented in
  `examples/schemas/hitl_response.json`).

### Assertions

Four assertions, each an invariant over the whole recorded trace (order-insensitive,
chosen to absorb LLM nondeterminism):

| Assertion | Semantics |
|---|---|
| `eventually` | at least `count` (default 1) events matching the predicate occur before the run ends; every matched event's payload is schema-validated if the predicate carries a `schema` |
| `never` | no event matching the predicate occurs anywhere in the trace |
| `paired` | every `tool_call_start` has a matching `tool_call_end` (no dangling tool calls) |
| `survives` | a named tool call's id is still present (string search) in the final `state_snapshot` — catches the artifact vanishing from the UI after the run ends |

Predicates match on event `type` plus `where` field filters (dot-path into the
event), and can carry a `schema` (JSON Schema file path) plus optional `schema_path`
(dot-path into the matched event to validate, default: the whole event).

### Schema path resolution

`schema:` paths in a scenario YAML resolve **relative to the YAML file itself**, not
the working directory — e.g. `examples/scenarios/item-create-cancel.yaml` references
`../schemas/item_detail.json`, which resolves against `examples/scenarios/`.

## Trace format

A trace is a JSONL file: one normalized event per line (`run_started`,
`run_finished`, `run_error`, `text_message`, `tool_call_start`, `tool_call_end`,
`state_snapshot`, `interrupt`, `resume`). This is the interchange format the whole
tool is built around — `record` produces it, `lint` consumes it, and it is the
planned fixture format for `aguiar mock` (v1.5), which will replay a blessed trace
as a live-looking stream for FE development without a running agent.

## Known v1 limits

1. **Runtime translation layer is untested.** v1's LangGraph adapter observes the
   client⇄agent boundary directly (`:2024`), bypassing any runtime translation
   layer between the agent and the UI (e.g. a CopilotKit runtime) entirely. A
   translation bug there can pass `aguiar check` while still breaking the FE.
   Closing this requires the planned v2 AG-UI adapter, which records both sides of
   the gateway and diffs the normalized traces.
2. **Traces vary run to run.** The agent calls real tools and LLMs, so exact tool
   sequences and timings are not reproducible; the assertion vocabulary (invariants
   over the whole trace, not exact-sequence matching) is designed to absorb this. A
   tool-stub mode is deferred.
3. **No no-write assertion in v1.**
   All three example scenarios contain the identical whole-trace `paired: tool_calls`
   assertion. No example scenario has a no-write assertion; the cancel path is where
   one was attempted. It was originally built with a
   `never: { event: tool_call_start, where: { name: create_item } }` assertion to
   express "no write happens on the cancel path," but this was withdrawn as
   unsound: the `never` predicate spans the *entire* trace, and a delegate tool can
   legitimately fire *before* the interrupt to raise the HITL gate in the first
   place — so the assertion would fail on every correct run. Expressing "no write
   *after* the cancel resume" requires a scoped/`after` operator that v1's
   assertion vocabulary does not have. Also note: `examples/schemas/hitl_response.json`
   documents the resume-value shape but is not yet referenced by any scenario's
   `schema:` field.
4. **No example scenario exercises `survives` yet.** All three
   `examples/scenarios/*.yaml` files omit the `survives` assertion, so the
   vanishing-artifact bug class (the motivating production bug for that assertion)
   is guarded only by the engine's synthetic tests (`tests/lint.test.ts`), not by a
   real example run. Add a `survives` assertion to the submit scenario
   (`examples/scenarios/item-create-submit.yaml`) once a live smoke run against a
   dev agent confirms the preview tool's real name.
