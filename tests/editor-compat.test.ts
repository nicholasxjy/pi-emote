import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CustomEditor, FooterComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";

initTheme("dark", false);
const root = fileURLToPath(new URL("..", import.meta.url));
const { loadExtensions } = await import(new URL("./core/extensions/loader.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const id = (s: string) => s;
const theme = { fg: (_c: string, s: string) => s, bold: id, getThinkingBorderColor: () => id };
const editorTheme = { borderColor: id, selectList: { selectedPrefix: id, selectedText: id, description: id, scrollInfo: id, noMatch: id } };
const click = (x: number, y: number): TuiMouseEvent => ({ type: "click", button: "left", x, y, screenX: x, screenY: y, width: 100, height: 10, shift: false, alt: false, ctrl: false });

class ForeignEditor extends CustomEditor {
  readonly routed: string[] = [];
  readonly clicks: TuiMouseEvent[] = [];
  render(w: number): string[] {
    const lines = super.render(w);
    if (lines[0]) lines[0] = "═".repeat(Math.max(1, w));
    if (lines[1]) lines[1] = "PL>" + lines[1].slice(Math.min(3, lines[1].length));
    return lines;
  }
  handleInput(data: string): void {
    if (data !== "\r" || this.isShowingAutocomplete()) return super.handleInput(data);
    const value = `[foreign] ${this.getText()}`;
    this.routed.push(value);
    this.setText("");
    this.onSubmit?.(value);
  }
  handleMouse(event: TuiMouseEvent) {
    this.clicks.push(event);
    if (event.type === "press") return { capture: true };
    return super.handleMouse(event);
  }
}

async function createHarness(t: TestContext) {
  const sandbox = mkdtempSync(join(tmpdir(), "pi-emote-compat-")), prevHome = process.env.HOME;
  process.env.HOME = sandbox;
  mkdirSync(join(sandbox, ".pi", "extensions", "pi-emote"), { recursive: true });
  writeFileSync(join(sandbox, ".pi", "extensions", "pi-emote", "config.json"), JSON.stringify({ layout: "side", emotes: [{ model: "*", "emote-set": "ascii" }] }));
  const loaded = await loadExtensions([join(root, "src", "index.ts")], sandbox);
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.getThinkingLevel = () => "high";
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });

  const above = new Container(), editorSlot = new Container(), below = new Container(), footerSlot = new Container();
  const tui: any = { terminal: { rows: 30, columns: 100 }, requestRender() {}, hasOverlay: () => false, children: [above, editorSlot, below, footerSlot] };
  const kb: any = { matches: (d: string, a: string) => d === "\x1b" && a === "app.interrupt" };
  const submitted: string[] = [];
  const defaultEditor = new CustomEditor(tui, editorTheme, kb);
  Object.assign(defaultEditor, { focused: true, onSubmit: (s: string) => { submitted.push(s); defaultEditor.setText(""); } });
  defaultEditor.setPaddingX(0);

  const model = { id: "test-model", name: "Test Model", provider: "test", reasoning: true, contextWindow: 200000 };
  const sessionManager = { getEntryCount: () => 0, getSessionId: () => "s", getLeafId: () => null, getEntries: () => [], getCwd: () => sandbox, getSessionName: () => "s" };
  const session: any = { model, state: { model, thinkingLevel: "high" }, modelRuntime: { isUsingSubscription: () => true }, getContextUsage: () => ({ tokens: 100, percent: 5, contextWindow: 200000 }), sessionManager };
  const footerData: any = { getGitBranch: () => "main", getExtensionStatuses: () => new Map(), getAvailableProviderCount: () => 1, onBranchChange: () => () => {} };
  const defaultFooter = new FooterComponent(session, footerData);
  let currentEditor: any = defaultEditor, editorFactory: any, customFooter: (Component & { dispose?: () => void }) | undefined;
  editorSlot.addChild(defaultEditor);
  footerSlot.addChild(defaultFooter);

  const widgets = new Map<string, Component & { dispose?: () => void }>();
  const belowWidgets = new Map<string, Component & { dispose?: () => void }>();
  const syncWidgets = () => {
    above.clear(); above.addChild(new Spacer(1));
    for (const w of widgets.values()) above.addChild(w);
    below.clear();
    for (const w of belowWidgets.values()) below.addChild(w);
  };
  syncWidgets();
  const setterCalls = { editor: 0, footer: 0 };
  const ctx: any = {
    hasUI: true, cwd: sandbox, model, sessionManager, getContextUsage: () => session.getContextUsage(),
    ui: {
      theme, notify() {}, onTerminalInput: () => () => {}, getEditorComponent: () => editorFactory,
      setWidget(key: string, content: any, options?: { placement?: string }) {
        const target = options?.placement === "belowEditor" ? belowWidgets : widgets;
        target.get(key)?.dispose?.(); target.delete(key);
        if (content !== undefined) target.set(key, typeof content === "function" ? content(tui, theme) : content);
        syncWidgets();
      },
      setEditorComponent(factory: any) {
        setterCalls.editor++; editorFactory = factory;
        const text = currentEditor.getText?.() ?? "";
        editorSlot.clear();
        currentEditor = factory ? factory(tui, editorTheme, kb) : defaultEditor;
        if (factory) {
          Object.assign(currentEditor, { onSubmit: defaultEditor.onSubmit, onChange: defaultEditor.onChange, focused: true });
          currentEditor.setPaddingX?.(defaultEditor.getPaddingX());
        }
        currentEditor.setText?.(text);
        editorSlot.addChild(currentEditor);
      },
      setFooter(factory: any) {
        setterCalls.footer++; customFooter?.dispose?.(); footerSlot.clear();
        customFooter = factory ? factory(tui, theme, footerData) : undefined;
        footerSlot.addChild(customFooter ?? defaultFooter);
      },
    },
  };

  let shutdownDone = false;
  const fire = async (type: string) => {
    if (type === "session_shutdown") shutdownDone = true;
    for (const h of loaded.extensions[0].handlers.get(type) ?? []) await h({ type }, ctx);
    if (type === "session_start") t.mock.timers.tick(500);
  };
  t.after(async () => {
    if (!shutdownDone) await fire("session_shutdown");
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    rmSync(sandbox, { recursive: true, force: true });
  });
  const typeAndEnter = (ed: { handleInput(d: string): void }, text: string) => { for (const ch of text) ed.handleInput(ch); ed.handleInput("\r"); };
  return { ctx, fire, typeAndEnter, defaultEditor, defaultFooter, submitted, widgets, setterCalls, editorSlot,
    render: (w = 100) => ({ above: above.render(w), editor: editorSlot.render(w), below: below.render(w), footer: footerSlot.render(w) }) };
}

test("side-editor compat across load order, custom footer, native restore, and shutdown", async (t) => {
  for (const order of ["foreign-first", "foreign-later"] as const) {
    await t.test(order, async (st) => {
      const h = await createHarness(st);
      const origDefault = { render: h.defaultEditor.render, mouse: h.defaultEditor.handleMouse, pad: h.defaultEditor.setPaddingX };
      const origFooterRender = h.defaultFooter.render;
      let foreign!: ForeignEditor;
      const foreignFactory = (tui: any, et: any, kb: any) => (foreign = new ForeignEditor(tui, et, kb));
      const origForeign = { render: ForeignEditor.prototype.render, mouse: ForeignEditor.prototype.handleMouse };

      h.ctx.ui.setWidget("other", () => ({ render: () => ["[other-widget]"], invalidate() {} }));
      if (order === "foreign-first") h.ctx.ui.setEditorComponent(foreignFactory);
      h.setterCalls.editor = h.setterCalls.footer = 0;
      await h.fire("session_start");
      assert.deepEqual(h.setterCalls, { editor: 0, footer: 0 });
      if (order === "foreign-later") {
        assert.ok(h.render().editor[1].includes("│ ❯"));
        h.ctx.ui.setEditorComponent(foreignFactory);
      }

      const side = h.render();
      assert.deepEqual([side.above, side.footer], [["", "[other-widget]"], []]);
      assert.ok(side.editor[1].includes("│ PL>") && !side.editor[1].includes("❯") && side.editor.some((l) => l.includes("(main)")));
      assert.deepEqual([h.defaultEditor.render, h.defaultEditor.handleMouse, h.defaultEditor.setPaddingX, h.defaultEditor.getPaddingX()], [origDefault.render, origDefault.mouse, origDefault.pad, 0]);
      assert.equal(foreign.getPaddingX(), 0);
      assert.equal(foreign.handleMouse(click(2, 1)), undefined);
      foreign.handleMouse(click(15, 1));
      assert.equal(foreign.clicks[0]?.x, 3);
      foreign.handleMouse({ ...click(15, 1), type: "press" });
      h.render(30);
      foreign.handleMouse({ ...click(2, 5), type: "release" });
      const release = foreign.clicks.at(-1);
      assert.deepEqual([release?.type, release?.x, release?.width], ["release", -10, 88]);
      h.typeAndEnter(foreign, order);
      assert.deepEqual([foreign.routed, h.submitted.at(-1)], [[`[foreign] ${order}`], `[foreign] ${order}`]);

      h.ctx.ui.setFooter(() => {
        const custom = new Container();
        custom.addChild(h.defaultFooter);
        custom.addChild({ render: () => ["[CUSTOM-FOOTER]"], invalidate() {} });
        return custom;
      });
      const customFooterFrame = h.render();
      assert.equal(h.defaultFooter.render, origFooterRender);
      assert.deepEqual(customFooterFrame.footer, []);
      assert.ok(customFooterFrame.editor.some((l) => l.startsWith("          │ ") && l.includes("[CUSTOM-FOOTER]")));
      assert.ok(customFooterFrame.editor.some((l) => l.includes("(main)")) && customFooterFrame.editor[1].includes("│ PL>"));

      h.ctx.ui.setFooter(undefined);
      h.ctx.ui.setEditorComponent(undefined);
      const native = h.render();
      assert.deepEqual([foreign.render, foreign.handleMouse], [origForeign.render, origForeign.mouse]);
      assert.ok(native.editor[1].includes("│ ❯") && native.editor.some((l) => l.includes("(main)")));
      h.typeAndEnter(h.defaultEditor, "native");
      assert.equal(h.submitted.at(-1), "native");

      h.ctx.ui.setEditorComponent(foreignFactory);
      h.render();
      h.setterCalls.editor = h.setterCalls.footer = 0;
      await h.fire("session_shutdown");
      assert.deepEqual(h.setterCalls, { editor: 0, footer: 0 });
      assert.equal(h.ctx.ui.getEditorComponent(), foreignFactory);
      assert.deepEqual([h.widgets.has("emote"), h.widgets.has("other")], [false, true]);
      assert.deepEqual([foreign.render, foreign.handleMouse, h.defaultFooter.render], [origForeign.render, origForeign.mouse, origFooterRender]);
      const post = h.render();
      assert.deepEqual(post.above, ["", "[other-widget]"]);
      assert.ok(post.editor[1].startsWith("PL>") && post.footer.some((l) => l.includes("(main)")));
      h.typeAndEnter(foreign, "after");
      assert.equal(h.submitted.at(-1), "[foreign] after");
    });
  }
});

test("below-editor widgets and custom footer share the right column and retain their mouse targets", async (t) => {
  const h = await createHarness(t);
  const clicks: TuiMouseEvent[] = [];
  const status = {
    render: (width: number) => [`[status ${width}]`],
    handleMouse: (event: TuiMouseEvent) => { clicks.push(event); return { focus: true, capture: true }; },
    invalidate() {},
  };
  const footer = { render: (width: number) => [`[footer ${width}]`], invalidate() {} };
  await h.fire("session_start");
  h.render();
  h.ctx.ui.setWidget("status", () => status, { placement: "belowEditor" });
  h.ctx.ui.setFooter(() => footer);
  const wide = h.render();
  const statusRow = wide.editor.findIndex((line) => line.slice(12) === "[status 88]");
  assert.equal(statusRow, 3);
  assert.equal(wide.editor[statusRow + 1].slice(12), "[footer 88]");
  assert.deepEqual([wide.below, wide.footer], [[], []]);

  const pressed = h.editorSlot.handleMouse({ ...click(16, statusRow), type: "press", height: wide.editor.length });
  assert.equal(pressed?.focusTarget, status);
  assert.deepEqual(pressed?.target, { component: status, originX: 12, originY: statusRow, width: 88, height: 1 });
  assert.deepEqual(clicks.map(({ x, y, width, height }) => [x, y, width, height]), [[4, 0, 88, 1]]);
  assert.equal(h.editorSlot.handleMouse({ ...click(2, statusRow), height: wide.editor.length }), undefined);
  assert.equal(clicks.length, 1);

  const narrow = h.render(30);
  assert.deepEqual(narrow.editor.slice(3), ["[status 30]", "[footer 30]"]);
  await h.fire("session_shutdown");
  const restored = h.render();
  assert.deepEqual([restored.below, restored.footer], [["[status 100]"], ["[footer 100]"]]);
  assert.equal(h.editorSlot.handleMouse, Container.prototype.handleMouse);
});

test("standalone fallback activates for locked render property or unsupported component", async (t) => {
  const h = await createHarness(t);
  const origFooterRender = h.defaultFooter.render;
  let locked!: ForeignEditor;
  h.ctx.ui.setEditorComponent((tui: any, et: any, kb: any) => {
    locked = new ForeignEditor(tui, et, kb);
    Object.defineProperty(locked, "render", { value: locked.render.bind(locked), writable: false, configurable: false });
    return locked;
  });

  h.ctx.ui.setWidget("status", () => ({ render: (width: number) => [`[status ${width}]`], invalidate() {} }), { placement: "belowEditor" });
  await h.fire("session_start");
  const lockedFrame = h.render();
  assert.equal(lockedFrame.above[1], "─".repeat(100));
  assert.ok(lockedFrame.above.some((l) => l.includes("Test Model")) && h.defaultFooter.render === origFooterRender);
  assert.ok(lockedFrame.footer.length > 0 && lockedFrame.editor[1].startsWith("PL>"));
  assert.deepEqual(lockedFrame.below, ["[status 100]"]);
  h.typeAndEnter(locked, "locked");
  assert.deepEqual(locked.routed, ["[foreign] locked"]);

  h.ctx.ui.setEditorComponent(() => ({ render: () => ["[unsupported]"], invalidate() {} }));
  const unsupportedFrame = h.render();
  assert.equal(unsupportedFrame.above[1], "─".repeat(100));
  assert.deepEqual(unsupportedFrame.editor, ["[unsupported]"]);
  assert.ok(unsupportedFrame.footer.length > 0);
});
