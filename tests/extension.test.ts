import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AsciiRenderer } from "../src/render_ascii.ts";
import { EMOTE_STATES, type EmoteState } from "../src/types.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const { loadExtensions } = await import(new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

test("Pi loads the extension and routes activity, prompts, results and previews", async (t) => {
  const sandbox = mkdtempSync(join(tmpdir(), "pi-emote-events-"));
  const previousHome = process.env.HOME;
  process.env.HOME = sandbox;
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(sandbox, { recursive: true, force: true });
  });
  const configDir = join(sandbox, ".pi", "extensions", "pi-emote");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({
    layout: "default", emotes: [{ model: "*", "emote-set": "ascii" }],
  }));
  const loaded = await loadExtensions([join(root, "src", "index.ts")], sandbox);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  loaded.runtime.getThinkingLevel = () => "high";
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  let widget: any;
  let keyHandler: (() => void) | undefined;
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  const ctx = {
    hasUI: true, cwd: sandbox, model: { id: "test-model", name: "Test", contextWindow: 200000 },
    sessionManager: { getEntries: () => [], getCwd: () => sandbox },
    getContextUsage: () => ({ tokens: 0, percent: 0, contextWindow: 200000 }),
    ui: {
      notify() {},
      setWidget: (_key: string, factory: any) => { widget = factory?.({ requestRender() {}, hasOverlay: () => false }, theme); },
      onTerminalInput: (handler: () => void) => { keyHandler = handler; return () => { keyHandler = undefined; }; },
    },
  };
  const fire = async (type: string, event: object = {}) => {
    for (const handler of extension.handlers.get(type) ?? []) await handler({ type, ...event }, ctx);
  };
  t.after(() => fire("session_shutdown"));
  const expected = new AsciiRenderer();
  expected.loadFrames(join(root, "emotes", "ascii"), root);
  const expectState = (state: EmoteState) => {
    const output = widget.render(100).join("\n");
    const frames = Array.from({ length: expected.getCycleFrameCount(state) }, (_, index) => {
      expected.showCycleFrame(state, index);
      const frame = expected.getRenderedFrame();
      return frame?.kind === "text" && output.includes(frame.lines[0]);
    });
    assert.ok(frames.some(Boolean), `${state}: ${output}`);
  };
  await fire("session_start");
  const command = extension.commands.get("emote")!;
  assert.ok(command.getArgumentCompletions("ver").some((item: any) => item.value === "verify"));
  for (const state of EMOTE_STATES) {
    await command.handler(state, ctx);
    expectState(state);
  }
  await command.handler("demo", ctx);
  t.mock.timers.tick(2500);
  expectState("idle");
  await fire("agent_start");
  t.mock.timers.tick(3000);
  expectState("think");
  await command.handler("demo", ctx);
  await fire("message_update", { message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta" } });
  t.mock.timers.tick(3000);
  expectState("think");

  await fire("tool_execution_start", { toolCallId: "a", toolName: "subagent", args: { agent: "worker" } });
  expectState("build");
  await fire("tool_execution_start", { toolCallId: "b", toolName: "read" });
  await fire("tool_execution_end", { toolCallId: "b", toolName: "read", isError: false });
  expectState("build");
  await fire("ui_prompt_start");
  expectState("ask");
  await fire("message_update", { message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta" } });
  expectState("ask");
  await fire("ui_prompt_end");
  expectState("think");
  await fire("tool_execution_end", { toolCallId: "a", toolName: "subagent", isError: false });
  await fire("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  expectState("success");

  await fire("agent_start");
  await fire("tool_execution_start", { toolCallId: "c", toolName: "read" });
  await fire("tool_execution_end", { toolCallId: "c", toolName: "read", isError: true });
  await fire("agent_end", { messages: [] });
  expectState("failure");
  await fire("agent_start");
  await fire("agent_end", { messages: [{ role: "assistant", stopReason: "aborted" }] });
  expectState("idle");

  await fire("input", { text: "再见！" });
  await fire("agent_start");
  await fire("agent_end", { messages: [] });
  expectState("bye");
  t.mock.timers.tick(2000);
  t.mock.timers.tick(30000);
  expectState("grandma");
  keyHandler!();
  expectState("idle");
});
