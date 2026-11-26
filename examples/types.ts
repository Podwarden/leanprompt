// What an example app (Tasks 13-14) provides to the replay harness (eval/run.ts).

import type { Dialect } from "@kvsig/core";
import type { LlmClient } from "../eval/client.js";

export type Scenario = { turns: { input: string }[]; sessions: number };

/** Judges the answers of one run. `answers[0]` is that run's answers, in call order. Never log the answers. */
export type Check = (answers: string[][]) => { pass: boolean; detail: string };

export interface ExampleApp {
  name: string;
  dialect: Dialect;
  /** Plays the scenario through `client`; returns one answer per turn, session after session. */
  run(client: LlmClient, scenario: Scenario): Promise<string[]>;
  /** The first request a session would send, so the stable-head CI test can point at it. */
  buildRequest(input: string, ctx: { session: number; turn: number; now: Date }): { dialect: Dialect; body: unknown };
  /** The scenario `leanprompt eval` replays. */
  scenario: Scenario;
  /** Settings for the offline simulator on `sim:*` targets: how long a token takes, and how long each reply is. Ignored on measured runs. */
  sim?: { msPerOutputToken?: number; outputTokens?: (input: string) => number };
  /** Required for measured (real provider) runs; simulated runs skip it. */
  check?: Check;
}

/**
 * What `examples/<app>/app.ts` must export: a factory for the app in its "before" or "after" form.
 */
export type CreateApp = (form: "before" | "after", opts?: AppOptions) => ExampleApp | Promise<ExampleApp>;

/** Everything optional; the defaults suit a plain `leanprompt eval` run. */
export interface AppOptions {
  /** `openai.chat` (default) or `anthropic.messages`. The harness picks it from the provider. */
  dialect?: Dialect;
  /** The app's clock. The default advances 90 seconds per call, so offline runs behave like real ones. */
  clock?: () => Date;
  /** Seeds the per-session shuffles of dict-tools-agent. */
  seed?: number;
  /** Waits between retries (timeout-retry). Tests and the simulator pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
}
