import { now, type NormalizedEvent } from "../events.js";
import type { Scenario } from "../contract.js";
import { matchesPredicate } from "../match.js";
import {
  newNormalizerState,
  normalizeChunk,
  type StreamChunk,
} from "./langgraph-normalize.js";

export interface LangGraphClientLike {
  threads: { create(): Promise<{ thread_id: string }> };
  runs: {
    stream(
      threadId: string,
      assistantId: string,
      payload: Record<string, unknown>,
    ): AsyncIterable<StreamChunk>;
  };
}

export async function recordScenario(
  client: LangGraphClientLike,
  scenario: Scenario,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [{ type: "run_started", ts: now() }];
  const state = newNormalizerState();
  const thread = await client.threads.create();
  // Watermark: index into `events` after which the current turn's events begin.
  // A chained expect_interrupt (no intervening `user` step) must only match an
  // interrupt raised by *this* turn's stream, not a stale one still sitting in
  // `events` from an earlier turn — otherwise a second expect_interrupt can be
  // satisfied by the first turn's interrupt even though nothing re-interrupted.
  let watermark = events.length;

  const consume = async (payload: Record<string, unknown>) => {
    for await (const chunk of client.runs.stream(thread.thread_id, scenario.agent, {
      ...payload,
      streamMode: ["values", "updates"],
    })) {
      events.push(...normalizeChunk(chunk, state));
    }
  };

  for (const [i, step] of scenario.steps.entries()) {
    if ("user" in step) {
      events.push({ type: "text_message", ts: now(), id: `user-${i}`, role: "user", content: step.user });
      await consume({
        input: { ...(scenario.context ?? {}), messages: [{ type: "human", content: step.user }] },
      });
    } else if ("respond" in step) {
      // Mark the watermark *before* this step's own events land, so a resume
      // that immediately re-interrupts is itself visible to the next
      // expect_interrupt check (which scans events after this point).
      watermark = events.length;
      events.push({ type: "resume", ts: now(), value: step.respond });
      await consume({ command: { resume: step.respond } });
    } else {
      const predicate = { event: "interrupt" as const, where: step.expect_interrupt.where };
      const matchedSinceWatermark = events.slice(watermark).some((e) => matchesPredicate(e, predicate));
      if (!matchedSinceWatermark) {
        console.error(
          `aguiar: no interrupt matching ${JSON.stringify(step.expect_interrupt.where ?? {})} — recording stops here; lint will report it`,
        );
        events.push({ type: "run_finished", ts: now() });
        return events;
      }
      watermark = events.length;
    }
  }

  events.push({ type: "run_finished", ts: now() });
  return events;
}
