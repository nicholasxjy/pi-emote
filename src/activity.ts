import type { EmoteState } from "./types.ts";

const TOOL_STATES: Record<string, EmoteState> = {
  read: "read", grep: "read", find: "read", ls: "read", glob: "read",
  mem_search: "read", mem_context: "read", mem_get_observation: "read",
  codegraph_explore: "explore", web_fetch: "read", fetch_content: "read", web_search: "explore",
  write: "write", edit: "write", multi_edit: "write", apply_patch: "write",
  ask_user_question: "ask", ask_user_choice: "ask", request_user_input: "ask",
  mem_session_summary: "bye", mem_save: "remember",
  bash_background: "jobs", bg_run: "jobs", bg_status: "jobs", bg_kill: "jobs",
  monitor: "jobs", job_list: "jobs", job_stop: "jobs",
};

const AGENT_STATES: [RegExp, EmoteState][] = [
  [/jira/, "jira"],
  [/judge|refuter/, "judge"],
  [/verif|validat/, "verify"],
  [/review/, "review"],
  [/worker|fix|apply|build/, "build"],
  [/explor/, "explore"],
];

export function agentToState(agent: unknown): EmoteState {
  const name = typeof agent === "string" ? agent.toLowerCase() : "";
  return AGENT_STATES.find(([pattern]) => pattern.test(name))?.[1] ?? "delegate";
}

export function toolNameToState(toolName: string, args?: unknown): EmoteState {
  const name = toolName.split("__").at(-1)!;
  if (/^subagent(?:_(?:run|continue|reply))?$/.test(name)) {
    const input = args as { agent?: unknown; tasks?: { agent?: unknown }[]; chain?: { agent?: unknown }[] } | undefined;
    if (input?.agent !== undefined) return agentToState(input.agent);
    const tasks = input?.tasks ?? input?.chain;
    if (Array.isArray(tasks) && tasks.length > 0) {
      const states = tasks.map((task) => agentToState(task?.agent));
      if (states.every((state) => state === states[0])) return states[0];
    }
    return "delegate";
  }
  return Object.hasOwn(TOOL_STATES, name) ? TOOL_STATES[name] : "tool";
}

export function isFarewell(text: string): boolean {
  return /^(?:bye(?:[ -]bye)?|goodbye|see you(?: later)?|ad[ií][oó]s|chau|再见|拜拜|回头见)[\s!！.。~～]*$/i.test(text.trim());
}
