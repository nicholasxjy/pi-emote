import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { FooterComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, CURSOR_MARKER, compositeTuiLine, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { SideEditor, findNativeFooter } from "../src/side-editor.ts";
import { createWidgetFactory } from "../src/widget.ts";
import { Animator } from "../src/animator.ts";
import type { Config } from "../src/types.ts";
import type { RenderedFrame } from "../src/renderer.ts";

initTheme("dark", false);

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  getThinkingBorderColor: () => (text: string) => text,
};
const editorTheme = {
  borderColor: (text: string) => text,
  selectList: {
    selectedPrefix: (text: string) => text,
    selectedText: (text: string) => text,
    description: (text: string) => text,
    scrollInfo: (text: string) => text,
    noMatch: (text: string) => text,
  },
};

function setup(initialFrame: RenderedFrame | null = { kind: "text", lines: ["(^_^)"] }) {
  const config: Config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
  config.layout = "side";
  let frame = initialFrame;
  const model = { id: "native-model", name: "Test model", provider: "test", reasoning: true, contextWindow: 2000 };
  const sessionManager = {
    getEntryCount: () => 0,
    getSessionId: () => "test-session",
    getLeafId: () => null,
    getEntries: () => [],
    getCwd: () => "/project",
    getSessionName: () => "demo",
  };
  const session = {
    model,
    routedModel: undefined as any,
    state: { model, thinkingLevel: "high" },
    modelRuntime: { isUsingSubscription: () => true },
    getContextUsage: () => ({ tokens: 100, percent: 5, contextWindow: 2000 }),
    sessionManager,
  };
  const statuses = new Map([["test", "Extension ready"]]);
  const footer = new FooterComponent(session as any, {
    getGitBranch: () => "main",
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  });
  const footerContainer = new Container();
  footerContainer.addChild(footer);
  const renderer = {
    setTui() {},
    getRenderedFrame: () => frame,
    dispose() { frame = null; },
    resetCache() {},
  };
  const deps = {
    config,
    animator: new Animator(config, renderer as any),
    pi: { getThinkingLevel: () => "high" },
    getCurrentEmoteSet: () => "ascii",
    getCtxRef: () => session,
    getTheme: () => theme,
    footer,
  };
  const tui = { terminal: { rows: 30 }, requestRender() {}, hasOverlay: () => false, children: [footerContainer] } as any;
  const keybindings = { matches: (data: string, action: string) => data === "\x1b" && action === "app.interrupt" } as any;
  const editor = new SideEditor(tui, editorTheme, keybindings, deps);
  editor.focused = true;
  return { editor, deps, tui, footer, session, statuses, renderer, setFrame: (next: RenderedFrame | null) => { frame = next; } };
}

function click(x: number, y: number): TuiMouseEvent {
  return { type: "click", button: "left", x, y, screenX: x, screenY: y, width: 80, height: 10, shift: false, alt: false, ctrl: false };
}

test("side layout keeps a full-width top border and uses Pi's native footer", () => {
  const { editor, deps, footer } = setup();
  deps.getCtxRef = () => { throw new Error("side layout must not build emote status information"); };
  editor.setText("你好");
  const lines = editor.render(80);
  assert.equal(lines.length, 6);
  assert.equal(lines[0], "─".repeat(80));
  assert.ok(lines[1].startsWith("          │ ❯ 你好"));
  assert.equal(visibleWidth(lines[1].split(CURSOR_MARKER)[0]), 18);
  assert.equal(lines[2].slice(12), "─".repeat(68));
  assert.deepEqual(lines.slice(3).map((line) => line.slice(12)), footer.render(68));
  assert.ok(lines.every((line) => visibleWidth(line) <= 80));
  assert.ok(!lines.join("\n").includes("Test model"));

  let submitted = "";
  editor.onSubmit = (text) => { submitted = text; };
  editor.handleInput("\r");
  assert.equal(submitted, "你好");
  let interrupted = false;
  editor.onEscape = () => { interrupted = true; };
  editor.handleInput("\x1b");
  assert.equal(interrupted, true);
});

test("prompt stays in native padding for empty and multiline input", () => {
  const { editor } = setup();
  editor.setPaddingX(0);
  const empty = editor.render(80);
  assert.ok(empty[1].startsWith("          │ ❯ " + CURSOR_MARKER));
  assert.equal(visibleWidth(empty[1].split(CURSOR_MARKER)[0]), 14);

  editor.setText("first\nsecond");
  const lines = editor.render(80);
  assert.ok(lines[1].startsWith("          │ ❯ first"));
  assert.ok(lines[2].startsWith("          │   second"));
  assert.equal(lines.join("\n").split("❯").length - 1, 1);
  assert.equal(editor.getText(), "first\nsecond");
  assert.ok(lines.every((line) => visibleWidth(line) <= 80));

  editor.setText("a");
  const tiny = editor.render(2);
  assert.ok(tiny[1].startsWith("a"));
  assert.ok(!tiny[1].includes("❯"));
});

test("native footer details and updates pass through without emote formatting", () => {
  const { editor, footer, session, statuses } = setup();
  session.routedModel = { model: { id: "routed-model" }, thinkingLevel: "low" };
  footer.setAutoCompactEnabled(false);
  statuses.set("aaa", "First\nstatus");
  const lines = editor.render(160).slice(3).map((line) => line.slice(12));
  assert.deepEqual(lines, footer.render(148));
  const text = lines.map(stripVTControlCharacters).join("\n");
  assert.ok(text.includes("(sub)"));
  assert.ok(text.includes("native-model • high → routed-model • low"));
  assert.ok(text.includes("5.0%/2.0k"));
  assert.ok(!text.includes("(auto)"));
  assert.equal(lines[2], "First status Extension ready");
});

test("native footer is located in Pi's nested component containers", () => {
  const { tui, footer } = setup();
  assert.equal(findNativeFooter(tui), footer);
  assert.equal(findNativeFooter({ ...tui, children: [] }), undefined);
});

test("top border preserves Pi's native working indicator", () => {
  const { editor } = setup();
  editor.setWorkingStatusIndicator({ renderInBorder: () => "Thinking...", renderSpinnerInBorder: () => "*" } as any);
  const top = editor.render(80)[0];
  assert.ok(top.includes("Thinking..."));
  assert.equal(visibleWidth(top), 80);
});

test("narrow terminals and missing frames keep the full-width editor and native footer", () => {
  const { editor, footer, setFrame } = setup();
  editor.setText("message");
  const narrow = editor.render(30);
  assert.equal(narrow[0], "─".repeat(30));
  assert.ok(narrow[1].startsWith("❯ message"));
  assert.equal(visibleWidth(narrow[1]), 30);
  assert.equal(narrow[2], "─".repeat(30));
  assert.deepEqual(narrow.slice(3), footer.render(30));
  assert.ok(narrow.every((line) => !line.includes("│") && visibleWidth(line) <= 30));
  setFrame(null);
  assert.equal(visibleWidth(editor.render(80)[1]), 80);
});

test("mouse clicks use editor coordinates after adding the avatar", () => {
  const { editor } = setup();
  editor.setText("abcdef\nsecond");
  editor.render(80);
  editor.handleMouse(click(12, 1));
  assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
  editor.handleMouse(click(16, 1));
  assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
  editor.handleMouse(click(15, 2));
  assert.deepEqual(editor.getCursor(), { line: 1, col: 1 });
  assert.equal(editor.handleMouse(click(1, 1)), undefined);
  assert.equal(editor.handleMouse(click(14, 4)), undefined);
});

test("native borders retain every autocomplete row and clicking a completion still works", async () => {
  const { editor } = setup();
  editor.setAutocompleteProvider({
    getSuggestions: () => ({ prefix: "/", items: ["/first", "/second", "/third"].map((value) => ({ value, label: value })) }),
    applyCompletion: (_lines, _line, _col, item) => ({ lines: [item.value], cursorLine: 0, cursorCol: item.value.length }),
  });
  editor.setText("/");
  editor.handleInput("\t");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(editor.isShowingAutocomplete(), true);
  const lines = editor.render(80);
  for (const label of ["/first", "/second", "/third"]) assert.ok(lines.some((line) => line.includes(label)));
  assert.equal(lines[2].slice(12), "─".repeat(68));
  editor.handleMouse(click(15, 5));
  assert.equal(editor.getText(), "/third");
});

test("all avatar protocols retain right-column rows taller than the avatar", () => {
  const frames: RenderedFrame[] = [
    { kind: "text", lines: ["(^_^)"] },
    { kind: "image", rows: 2, sequence: "KITTY", cursorAdvances: false },
    { kind: "image", rows: 2, sequence: "ITERM", cursorAdvances: true },
    { kind: "placeholder", rows: 2, lines: ["12345678", "12345678"] },
  ];
  const content = ["one", "two", "three", "four", "five", "six"];
  for (const frame of frames) {
    const { editor } = setup(frame);
    editor.setText(content.join("\n"));
    const lines = editor.render(80);
    assert.equal(lines.length, content.length + 5, frame.kind);
    content.forEach((line, i) => assert.ok(lines[i + 1].includes(line), `${frame.kind}: ${line}`));
  }
});

test("popup content remains visible over an image avatar", () => {
  const frame: RenderedFrame = {
    kind: "image", rows: 4, cursorAdvances: false,
    sequence: "\x1b_Ga=T,f=100;AA==\x1b\\",
  };
  const { editor, tui } = setup(frame);
  tui.hasOverlay = () => true;
  const lines = editor.render(80);
  const composed = compositeTuiLine(lines[1], "Context popup contents", 0, 80, 80);
  assert.ok(composed.includes("Context popup contents"), "avatar must not block the popup compositor");
});

test("image avatars clear once for a popup and restore without an animation tick", (t) => {
  const frame: RenderedFrame = { kind: "image", rows: 4, cursorAdvances: false, sequence: "AVATAR" };
  const { editor, tui, renderer } = setup(frame);
  const dispose = t.mock.method(renderer, "dispose");
  const reset = t.mock.method(renderer, "resetCache");
  assert.ok(editor.render(80).some((line) => line.includes("AVATAR")));

  tui.hasOverlay = () => true;
  for (let i = 0; i < 3; i++) {
    assert.ok(editor.render(80).every((line) => !line.includes("AVATAR")));
  }
  assert.equal(dispose.mock.callCount(), 1);
  assert.equal(reset.mock.callCount(), 1);

  tui.hasOverlay = () => false;
  for (let i = 0; i < 2; i++) {
    assert.ok(editor.render(80).some((line) => line.includes("AVATAR")));
  }
  tui.hasOverlay = () => true;
  editor.render(80);
  assert.equal(dispose.mock.callCount(), 2);
});

test("animation updates stay hidden until the popup closes", () => {
  const frame: RenderedFrame = { kind: "image", rows: 4, cursorAdvances: true, sequence: "OLD_AVATAR" };
  const { editor, tui, setFrame } = setup(frame);
  editor.render(80);
  tui.hasOverlay = () => true;
  editor.render(80);
  setFrame({ ...frame, sequence: "NEW_AVATAR" });
  assert.ok(editor.render(80).every((line) => !line.includes("NEW_AVATAR")));
  tui.hasOverlay = () => false;
  const restored = editor.render(80).join("\n");
  assert.ok(restored.includes("NEW_AVATAR"));
  assert.ok(!restored.includes("OLD_AVATAR"));
});

test("default widget also hides for popups and returns after they close", () => {
  const { deps, tui } = setup();
  deps.config.layout = "default";
  const widget = createWidgetFactory(deps)(tui, theme);
  assert.ok(widget.render(80).some((line) => line.includes("(^_^)")));
  tui.hasOverlay = () => true;
  assert.deepEqual(widget.render(80), []);
  tui.hasOverlay = () => false;
  assert.ok(widget.render(80).some((line) => line.includes("(^_^)")));
});

test("default widget retains its top border and model panel", () => {
  const { deps, tui } = setup();
  deps.config.layout = "default";
  const widget = createWidgetFactory(deps)(tui, theme);
  const lines = widget.render(80);
  assert.equal(lines[0], "─".repeat(80));
  assert.ok(lines.some((line) => line.includes("Test model")));
  assert.ok(lines.some((line) => line.includes("⏵▕")));
});
