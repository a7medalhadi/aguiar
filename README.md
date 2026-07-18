# aguiar — AG-UI Assertion Runner

Contract testing for agent event streams. **aguiar** (**AG-UI** **A**ssertion
**R**unner) is Pact-style contract testing adapted to nondeterministic LLM agent
streams: it plays a scripted user conversation against a real agent, records the
normalized event stream, and checks it against a YAML contract of shape and
behavior assertions. v1 speaks to LangGraph agents directly. The three CLI verbs
are:

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
npm install -g https://github.com/a7medalhadi/aguiar/releases/download/v0.2.1/aguiar-0.2.1.tgz
aguiar --help
```

Or run it one-off without installing anything:

```bash
npx https://github.com/a7medalhadi/aguiar/releases/download/v0.2.1/aguiar-0.2.1.tgz --help
```

To add it to a project instead (e.g. as a devDependency for CI), a git spec also
works: `npm install -D github:a7medalhadi/aguiar` (builds on install; note that
*global* installs from a git spec hit a known npm limitation — use the release
tarball above for `-g`).

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
`langgraph dev` from your agent's project. (The bundled `examples/` scenarios
expect an agent exposing an `example_agent` graph; point your own scenarios at
your own graph name via the scenario's `agent:` field.)

## Contract authoring

A scenario is a YAML file with two parts: a scripted conversation (`steps`) and a
list of invariants to check against the resulting trace (`assert`).

### Steps

Each step is exactly one of:

- `user: "<text>"` — send a message as the user.
- `expect_interrupt: { where?: ..., timeout_s?: ... }` — wait for an `interrupt`
  event, optionally filtered by field. `timeout_s` is accepted but not enforced.
- `respond: { action: submit | change | cancel, value?: ... }` — resume the
  interrupted run with a HITL response (shape documented in
  `examples/schemas/hitl_response.json`).

### Context and headers

Driving an agent directly bypasses whatever your production ingress injects into
the run (auth tokens, user/tenant ids, locale). Two optional top-level blocks
supply those:

```yaml
context:            # merged into the run input alongside `messages`
  store_id: "${MY_STORE_ID}"
  token: "${MY_TOKEN}"
headers:            # default HTTP headers on the LangGraph client
  X-Access-Client-Id: "${ACCESS_ID}"
```

`${VAR}` references inside `context` and `headers` are replaced from the
environment at load time; an unset variable is a hard error (exit 2), so secrets
stay out of committed YAML and an empty token is never sent silently.

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
`state_snapshot`, `interrupt`, `resume`). `record` produces it and `lint` consumes
it, so traces can be archived, diffed, and re-linted offline without an agent
connection.

## Limitations

1. **The tool observes the client⇄agent boundary directly.** Any translation
   layer sitting between the agent and your UI (e.g. a CopilotKit runtime) is
   outside what `aguiar check` verifies — a bug there can pass the contract while
   still breaking the UI.
2. **Traces vary run to run.** Agents call real tools and LLMs, so exact tool
   sequences and timings are not reproducible. The assertion vocabulary is
   whole-trace invariants rather than exact-sequence matching for precisely this
   reason.
3. **Assertions span the entire trace.** There is no scoped "after event X"
   operator, so properties like "no write happens *after* the user cancels"
   cannot be expressed — a `never` on a tool that legitimately fires earlier in
   the run (e.g. to raise the HITL gate) would fail on every correct run.

## License

[MIT](LICENSE)
