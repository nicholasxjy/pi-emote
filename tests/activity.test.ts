import { test } from "node:test";
import assert from "node:assert/strict";
import { agentToState, toolNameToState, isFarewell } from "../src/activity.ts";

test("tools select activity scenes, including namespaced MCP tools", () => {
  for (const [name, state] of Object.entries({
    read: "read", grep: "read", find: "read", ls: "read", web_fetch: "read",
    write: "write", edit: "write", apply_patch: "write", multi_edit: "write",
    ask_user_question: "ask", ask_user_choice: "ask", mem_save: "remember",
    mem_session_summary: "bye", bg_run: "jobs", bash_background: "jobs", job_list: "jobs",
    web_search: "explore", bash: "tool", unknown: "tool", constructor: "tool",
  })) {
    assert.equal(toolNameToState(name), state, name);
    assert.equal(toolNameToState(`mcp__server__${name}`), state, name);
  }
});

test("subagent roles choose the matching scene and mixed batches delegate", () => {
  for (const [agent, state] of Object.entries({
    explorer: "explore", worker: "build", fixer: "build", validator: "verify",
    verifier: "verify", judge: "judge", refuter: "judge", "review-security": "review",
    "JIRA-agent": "jira", custom: "delegate",
  })) {
    assert.equal(agentToState(agent), state);
    assert.equal(toolNameToState("mcp__agents__subagent_run", { agent }), state);
    assert.equal(toolNameToState("subagent", { tasks: [{ agent }, { agent }] }), state);
  }
  assert.equal(toolNameToState("subagent", { chain: [{ agent: "worker" }] }), "build");
  assert.equal(toolNameToState("subagent", { tasks: [{ agent: "worker" }, { agent: "explorer" }] }), "delegate");
  for (const args of [undefined, null, {}, { agent: 123 }, { tasks: [] }, { tasks: [null] }]) {
    assert.equal(toolNameToState("subagent_continue", args), "delegate");
  }
});

test("only a standalone farewell triggers the goodbye scene", () => {
  for (const text of ["bye", "Goodbye!", " see you later. ", "adiós", "再见！", "拜拜~"]) {
    assert.equal(isFarewell(text), true, text);
  }
  for (const text of ["", "add a goodbye button", "do not say bye", "再见阶段缺少头像"]) {
    assert.equal(isFarewell(text), false, text);
  }
});
