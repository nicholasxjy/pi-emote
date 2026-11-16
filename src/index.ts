import type { ExtensionAPI, FooterComponent } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";

import { EMOTE_STATES } from "./types.ts";
import type { EmoteState, ResolvedRenderer } from "./types.js";
import { toolNameToState, isFarewell } from "./activity.ts";
import type { Renderer } from "./renderer.js";
import { log, setDebug } from "./log.js";
import { loadLayeredConfig } from "./config.js";
import { resolveEmoteSet, findEmoteSetDir, loadEmotesConfig } from "./emotes.js";
import { KittyRenderer } from "./render_kitty.js";
import { TmuxKittyRenderer } from "./render_tmux_kitty.js";
import { TmuxKittyUnicodeRenderer } from "./render_tmux_kitty_unicode.js";
import { ITermRenderer } from "./render_iterm.js";
import { TmuxITermRenderer } from "./render_tmux_iterm.js";
import { AsciiRenderer } from "./render_ascii.js";
import { Animator } from "./animator.js";
import { createWidgetFactory } from "./widget.js";
import { SideEditor, findNativeFooter } from "./side-editor.js";
import { resolveRenderer } from "./terminal.js";

/** Check if a set directory contains any image frames (PNG files in state subdirs). */
function hasImageFrames(setDir: string): boolean {
  for (const state of EMOTE_STATES) {
    const stateDir = join(setDir, state);
    if (existsSync(stateDir)) {
      const files = readdirSync(stateDir).filter((f) => f.endsWith(".png"));
      if (files.length > 0) return true;
    }
  }
  return false;
}

function createRendererFromResolved(resolved: ResolvedRenderer, size: number): Renderer {
  const { protocol, multiplexer } = resolved;
  if (protocol === "kitty-unicode") {
    log(`createRenderer: using TmuxKittyUnicodeRenderer`);
    return new TmuxKittyUnicodeRenderer(size);
  }
  if (protocol === "kitty") {
    if (multiplexer === "tmux") {
      log(`createRenderer: using TmuxKittyRenderer`);
      return new TmuxKittyRenderer(size);
    }
    log(`createRenderer: using KittyRenderer`);
    return new KittyRenderer(size);
  }
  if (protocol === "iterm2") {
    if (multiplexer === "tmux") {
      log(`createRenderer: using TmuxITermRenderer`);
      return new TmuxITermRenderer(size);
    }
    log(`createRenderer: using ITermRenderer`);
    return new ITermRenderer(size);
  }
  log(`createRenderer: using AsciiRenderer`);
  return new AsciiRenderer();
}

export default function (pi: ExtensionAPI) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const extDir = dirname(__dirname);

  let cwd = process.cwd();
  let { config, userConfiguredTerminals } = loadLayeredConfig(extDir, cwd);
  setDebug(config.debug);

  if (!config.enabled) return;

  // Emote set state
  let currentEmoteSet = "default";
  let ctxRef: any = null;
  let widgetActive = false;
  let sideLayoutActive = false;
  let lastResolved = resolveRenderer(config.terminals, userConfiguredTerminals);
  let renderer = createRendererFromResolved(lastResolved, config.size);

  const animator = new Animator(config, renderer);
  const activeTools = new Map<string, EmoteState>();
  let runUsedTools = false;
  let runHadError = false;
  let farewell = false;
  let stopTerminalInput: (() => void) | null = null;
  let greetTimer: ReturnType<typeof setTimeout> | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let demoTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPreview() {
    if (greetTimer) { clearTimeout(greetTimer); greetTimer = null; }
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
  }

  function previewState(state: EmoteState) {
    animator.setAfterTalkState("idle");
    animator.transitionTo(state);
    if (state === "talk") animator.onTalkToken("Preview the avatar talking for a few seconds.");
    if (state !== "idle") {
      previewTimer = setTimeout(() => {
        previewTimer = null;
        animator.transitionTo("idle");
      }, 6000);
    }
  }

  function playDemo(index = 0) {
    const state = EMOTE_STATES[index];
    if (!state) { animator.transitionTo("idle"); return; }
    previewState(state);
    demoTimer = setTimeout(() => {
      clearPreview();
      playDemo(index + 1);
    }, 2500);
  }

  pi.registerCommand("emote", {
    description: "Preview an avatar state: /emote <state> | demo",
    getArgumentCompletions: (prefix) => [...EMOTE_STATES, "demo"]
      .filter((name) => name.startsWith(prefix.trim()))
      .map((name) => ({ value: name, label: name })),
    handler: async (args, ctx) => {
      if (!widgetActive) return;
      const name = args.trim();
      if (name === "demo" || EMOTE_STATES.includes(name as EmoteState)) {
        clearPreview();
        if (name === "demo") playDemo();
        else previewState(name as EmoteState);
      } else {
        ctx.ui.notify(`[pi-emote] /emote <state>: ${[...EMOTE_STATES, "demo"].join(", ")}`, "info");
      }
    },
  });

  function loadEmoteSet(setName: string) {
    currentEmoteSet = setName;

    const setDir = findEmoteSetDir(setName, extDir, cwd);
    const isAsciiOnly = existsSync(join(setDir, "ascii.yaml")) && !hasImageFrames(setDir);

    if (isAsciiOnly) {
      // ASCII-only set — use AsciiRenderer regardless of terminal
      if (!(renderer instanceof AsciiRenderer)) {
        renderer = new AsciiRenderer();
        animator.setRenderer(renderer);
      }
    } else {
      // Ensure we're using the capability-based renderer
      const detected = createRendererFromResolved(lastResolved, config.size);
      if (renderer.constructor !== detected.constructor) {
        renderer = detected;
        animator.setRenderer(renderer);
      }
    }

    const emotesConfig = loadEmotesConfig(setDir);
    renderer.loadFrames(setDir, extDir);
    animator.setEmotesConfig(emotesConfig);
  }

  loadEmoteSet("default");

  function switchEmoteSet(modelId: string, thinkingLevel: string) {
    const setName = resolveEmoteSet(modelId, thinkingLevel, config.emotes);
    if (setName !== currentEmoteSet) {
      loadEmoteSet(setName);
      log(`switchEmoteSet: loaded "${setName}", state="${animator.currentState}"`);
      animator.resetRenderCache();
      if (widgetActive && animator.currentState === "idle") {
        animator.enterIdle();
      } else if (widgetActive) {
        renderer.showRandomFrame(animator.currentState, true);
      }
    }
  }

  // --- Events ---

  pi.on("session_start", async (_event, ctx) => {
    log(`session_start: hasUI=${ctx.hasUI}`);
    if (!ctx.hasUI) return;

    clearPreview();
    stopTerminalInput?.();
    animator.clearAllTimers();
    activeTools.clear();
    farewell = false;
    cwd = ctx.cwd;
    ({ config, userConfiguredTerminals } = loadLayeredConfig(extDir, cwd));
    setDebug(config.debug);
    animator.updateConfig(config);

    // Re-create renderer in case terminal capabilities changed
    lastResolved = resolveRenderer(config.terminals, userConfiguredTerminals);
    renderer = createRendererFromResolved(lastResolved, config.size);
    animator.setRenderer(renderer);

    if (lastResolved.warning) {
      ctx.ui.notify(lastResolved.warning, lastResolved.warningLevel);
    } else if (renderer instanceof AsciiRenderer) {
      ctx.ui.notify("[pi-emote] No image protocol detected \u2014 using ASCII emotes.", "warning");
    }

    ctxRef = ctx;

    if (!config.enabled) return;

    // Resolve emote set for current model and thinking level
    const modelId = ctx.model?.id ?? "";
    const thinkingLevel = pi.getThinkingLevel();
    const setName = resolveEmoteSet(modelId, thinkingLevel, config.emotes);
    log(`session_start: model="${modelId}" thinkingLevel="${thinkingLevel}" set="${setName}" dir="${findEmoteSetDir(setName, extDir, cwd)}"`);
    loadEmoteSet(setName);

    const deps = {
      animator,
      config,
      pi,
      getCtxRef: () => ctxRef,
      getCurrentEmoteSet: () => currentEmoteSet,
    };
    if (config.layout === "side") {
      let footer: FooterComponent | undefined;
      ctx.ui.setEditorComponent((tui, theme, keybindings) => {
        footer ??= findNativeFooter(tui);
        return new SideEditor(tui, theme, keybindings, {
          ...deps,
          getTheme: () => ctx.ui.theme,
          footer,
        });
      });
      if (footer) ctx.ui.setFooter(() => ({ render: () => [], invalidate() {} }));
      sideLayoutActive = true;
    } else {
      ctx.ui.setWidget("emote", createWidgetFactory(deps), { placement: "aboveEditor" });
    }

    widgetActive = true;
    stopTerminalInput = ctx.ui.onTerminalInput(() => { animator.touch(); });
    greetTimer = setTimeout(() => {
      greetTimer = null;
      animator.transitionTo("hi");
    }, 500);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearPreview();
    stopTerminalInput?.();
    stopTerminalInput = null;
    activeTools.clear();
    animator.clearAllTimers();
    animator.disposeRenderer();
    if (widgetActive && ctx.hasUI) {
      if (sideLayoutActive) {
        ctx.ui.setEditorComponent(undefined);
        ctx.ui.setFooter(undefined);
        sideLayoutActive = false;
      } else {
        ctx.ui.setWidget("emote", undefined);
      }
      widgetActive = false;
    }
    animator.setTui(null);
    ctxRef = null;
  });

  pi.on("model_select", async (event) => {
    if (!widgetActive) return;
    const modelId = event.model?.id ?? "";
    const thinkingLevel = pi.getThinkingLevel();
    const resolved = resolveEmoteSet(modelId, thinkingLevel, config.emotes);
    log(`model_select: model="${modelId}" thinkingLevel="${thinkingLevel}" resolved="${resolved}" current="${currentEmoteSet}"`);
    switchEmoteSet(modelId, thinkingLevel);
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    if (!widgetActive) return;
    const modelId = ctx.model?.id ?? "";
    const resolved = resolveEmoteSet(modelId, event.level, config.emotes);
    log(`thinking_level_select: model="${modelId}" thinkingLevel="${event.level}" resolved="${resolved}" current="${currentEmoteSet}"`);
    switchEmoteSet(modelId, event.level);
  });

  pi.on("input", async (event) => {
    if (!widgetActive) return;
    clearPreview();
    farewell = isFarewell(event.text);
    animator.touch();
  });

  pi.on("agent_start", async () => {
    if (!widgetActive) return;
    clearPreview();
    runUsedTools = false;
    runHadError = false;
    activeTools.clear();
    animator.setAfterTalkState("idle");
    animator.transitionTo("think");
  });

  pi.on("ui_prompt_start", async () => {
    if (!widgetActive) return;
    clearPreview();
    animator.beginPrompt();
  });

  pi.on("ui_prompt_end", async () => {
    if (widgetActive) animator.endPrompt();
  });

  pi.on("message_update", async (event) => {
    if (!widgetActive) return;
    if (event.message?.role !== "assistant") return;

    const streamEvent = event.assistantMessageEvent;
    if (!streamEvent) return;
    clearPreview();

    if (streamEvent.type === "thinking_start" || streamEvent.type === "thinking_delta") {
      if (animator.currentState !== "think") {
        animator.transitionTo("think");
      }
      return;
    }

    if (streamEvent.type === "toolcall_start") {
      const partial = streamEvent.partial;
      const block = partial?.content?.[streamEvent.contentIndex];
      if (block && "name" in block && block.name) {
        animator.transitionTo(toolNameToState(block.name, block.arguments));
      } else {
        animator.transitionTo("tool");
      }
      return;
    }

    if (streamEvent.type !== "text_delta") return;
    const text = streamEvent.delta;
    if (!text) return;

    if (animator.currentState !== "talk") {
      animator.transitionTo("talk");
    }
    animator.onTalkToken(text);
  });

  pi.on("agent_end", async (event) => {
    if (!widgetActive) return;
    const lastAssistant = event.messages.findLast((message) => message.role === "assistant");
    const finale: EmoteState = lastAssistant?.stopReason === "aborted" ? "idle"
      : lastAssistant?.stopReason === "error" ? "failure"
      : farewell ? "bye" : runUsedTools && !runHadError ? "success" : "idle";
    farewell = false;
    activeTools.clear();
    if (animator.currentState === "talk") {
      animator.setAfterTalkState(finale);
      animator.endTalk();
    } else if (!["hi", "compact", "failure"].includes(animator.currentState)) {
      animator.transitionTo(finale);
    }
  });

  pi.on("tool_execution_start", async (event) => {
    if (!widgetActive) return;
    clearPreview();
    runUsedTools = true;
    const state = toolNameToState(event.toolName, event.args);
    activeTools.set(event.toolCallId, state);
    animator.transitionTo(state);
  });

  pi.on("tool_execution_end", async (event) => {
    if (!widgetActive) return;
    clearPreview();
    activeTools.delete(event.toolCallId);
    const nextState = [...activeTools.values()].at(-1) ?? "read";
    if (event.isError) {
      runHadError = true;
      animator.setHoldNextState(nextState);
      animator.transitionTo("failure");
    } else {
      animator.transitionTo(nextState);
    }
  });

  pi.on("session_before_compact", async () => {
    if (!widgetActive) return;
    clearPreview();
    animator.transitionTo("compact");
  });

  pi.on("session_compact", async () => {
    if (!widgetActive) return;
    clearPreview();
    animator.transitionTo("idle");
  });
}
