import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CURSOR_MARKER, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { SideEditor } from "../src/side-editor.ts";
import { createWidgetFactory } from "../src/widget.ts";
import type { Config } from "../src/types.ts";
import type { RenderedFrame } from "../src/renderer.ts";

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
  const deps = {
    config,
    animator: { setTui() {}, getRenderedFrame: () => frame } as any,
    pi: { getThinkingLevel: () => "high" },
    getCurrentEmoteSet: () => "ascii",
    getCtxRef: () => ({
      model: { name: "Test model", reasoning: true },
      getContextUsage: () => ({ tokens: 100, percent: 5, contextWindow: 2000 }),
      sessionManager: { getEntries: () => [], getCwd: () => "/project", getSessionName: () => "demo" },
    }),
    getTheme: () => theme,
    getFooterData: () => ({
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map([["test", "Extension ready"]]),
      getAvailableProviderCount: () => 1,
      onBranchChange: () => () => {},
    }),
  };
  const tui = { terminal: { rows: 30 }, requestRender() {} } as any;
  const keybindings = { matches: (data: string, action: string) => data === "\x1b" && action === "app.interrupt" } as any;
  const editor = new SideEditor(tui, editorTheme, keybindings, deps);
  editor.focused = true;
  return { editor, deps, tui, setFrame: (next: RenderedFrame | null) => { frame = next; } };
}

function click(x: number, y: number): TuiMouseEvent {
  return { type: "click", button: "left", x, y, screenX: x, screenY: y, width: 80, height: 10, shift: false, alt: false, ctrl: false };
}

test("side layout places the live editor and status beside the avatar without horizontal borders", () => {
  const { editor } = setup();
  editor.setText("你好");
  const lines = editor.render(80);
  assert.equal(lines.length, 4);
  assert.ok(lines[0].startsWith("          │ 你好"));
  assert.equal(visibleWidth(lines[0].split(CURSOR_MARKER)[0]), 16);
  assert.ok(lines.some((line) => line.includes("/project (main) • demo")));
  assert.ok(lines.some((line) => line.includes("Test model • high")));
  assert.ok(lines.some((line) => line.includes("Extension ready")));
  assert.ok(lines.every((line) => !line.includes("─") && visibleWidth(line) <= 80));

  let submitted = "";
  editor.onSubmit = (text) => { submitted = text; };
  editor.handleInput("\r");
  assert.equal(submitted, "你好");
  let interrupted = false;
  editor.onEscape = () => { interrupted = true; };
  editor.handleInput("\x1b");
  assert.equal(interrupted, true);
});

test("narrow terminals and missing frames keep the full-width editor", () => {
  const { editor, setFrame } = setup();
  editor.setText("message");
  const narrow = editor.render(30);
  assert.ok(narrow[0].startsWith("message"));
  assert.equal(visibleWidth(narrow[0]), 30);
  assert.ok(narrow.every((line) => !line.includes("│") && visibleWidth(line) <= 30));
  setFrame(null);
  assert.equal(visibleWidth(editor.render(80)[0]), 80);
});

test("mouse clicks use editor coordinates after removing borders and adding the avatar", () => {
  const { editor } = setup();
  editor.setText("abcdef\nsecond");
  editor.render(80);
  editor.handleMouse(click(14, 0));
  assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
  editor.handleMouse(click(13, 1));
  assert.deepEqual(editor.getCursor(), { line: 1, col: 1 });
  assert.equal(editor.handleMouse(click(1, 0)), undefined);
});

test("border removal retains every autocomplete row and clicking a completion still works", async () => {
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
  editor.handleMouse(click(15, 3));
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
    assert.equal(lines.length, content.length + 3, frame.kind);
    content.forEach((line, i) => assert.ok(lines[i].includes(line), `${frame.kind}: ${line}`));
  }
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
