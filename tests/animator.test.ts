import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Animator } from "../src/animator.ts";
import { AsciiRenderer } from "../src/render_ascii.ts";
import { EMOTE_STATES, type Config } from "../src/types.ts";

function setup(t: any) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const config: Config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
  const renderer = new AsciiRenderer();
  const root = fileURLToPath(new URL("..", import.meta.url));
  renderer.loadFrames(`${root}/emotes/ascii`, root);
  const animator = new Animator(config, renderer);
  t.after(() => animator.clearAllTimers());
  return { animator, renderer, config, tick: (ms: number) => t.mock.timers.tick(ms) };
}

test("every supported state renders with real built-in frames", (t) => {
  const { animator, renderer } = setup(t);
  for (const state of EMOTE_STATES) {
    animator.transitionTo(state);
    assert.equal(animator.currentState, state);
    assert.ok(renderer.getRenderedFrame(), state);
  }
});

test("activity frames cycle, held success animates then resumes", (t) => {
  const { animator, renderer, config, tick } = setup(t);
  for (const state of ["explore", "build", "verify", "delegate", "jobs"] as const) {
    animator.transitionTo(state);
    const first = renderer.getRenderedFrame();
    tick(config.cycleMs);
    assert.notDeepEqual(renderer.getRenderedFrame(), first, state);
  }
  animator.setHoldNextState("read");
  animator.transitionTo("success");
  const first = renderer.getRenderedFrame();
  tick(config.cycleMs);
  assert.notDeepEqual(renderer.getRenderedFrame(), first);
  tick(config.holdDuration.success - config.cycleMs);
  assert.equal(animator.currentState, "read");
  animator.transitionTo("bye");
  tick(config.holdDuration.bye);
  assert.equal(animator.currentState, "idle");
});

test("idle activity postpones grandma, keyboard activity wakes it, zero disables it", (t) => {
  const { animator, config, tick } = setup(t);
  animator.transitionTo("idle");
  tick(config.grandmaAfterMs - 1);
  animator.touch();
  tick(1);
  assert.equal(animator.currentState, "idle");
  tick(config.grandmaAfterMs - 1);
  assert.equal(animator.currentState, "grandma");
  animator.touch();
  assert.equal(animator.currentState, "idle");
  config.grandmaAfterMs = 0;
  animator.transitionTo("idle");
  tick(60000);
  assert.equal(animator.currentState, "idle");
});

test("nested prompts keep ask visible and restore the latest activity", (t) => {
  const { animator } = setup(t);
  animator.transitionTo("build");
  animator.beginPrompt();
  animator.beginPrompt();
  animator.transitionTo("verify");
  assert.equal(animator.currentState, "ask");
  animator.endPrompt();
  assert.equal(animator.currentState, "ask");
  animator.endPrompt();
  assert.equal(animator.currentState, "verify");
  animator.endPrompt();
  assert.equal(animator.currentState, "verify");
});

test("reading time finishes before success or goodbye is shown", (t) => {
  const { animator, config, tick } = setup(t);
  for (const finale of ["success", "bye"] as const) {
    animator.transitionTo("talk");
    animator.onTalkToken("one two three four five six seven eight");
    animator.setAfterTalkState(finale);
    animator.endTalk();
    assert.equal(animator.currentState, "talk");
    tick(2001);
    assert.equal(animator.currentState, finale);
    tick(config.holdDuration[finale]);
    assert.equal(animator.currentState, "idle");
  }
});

test("shutdown clears idle, cycle and prompt timers", (t) => {
  const { animator, config, tick } = setup(t);
  animator.transitionTo("idle");
  animator.clearAllTimers();
  tick(config.grandmaAfterMs * 2);
  assert.equal(animator.currentState, "idle");
  animator.beginPrompt();
  animator.clearAllTimers();
  animator.transitionTo("build");
  assert.equal(animator.currentState, "build");
});
