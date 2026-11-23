import { Container, Editor, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { colorStyler, createWidgetFactory, renderFrame, TEXT_CANVAS_COLS, type WidgetDeps } from "./widget.ts";

function replaceMethod<C extends Component, K extends keyof C>(component: C, key: K, method: C[K]) {
  const original = Object.getOwnPropertyDescriptor(component, key);
  if (original ? !original.configurable || !original.writable : !Object.isExtensible(component)) return;
  Object.defineProperty(component, key, { configurable: true, writable: true, ...original, value: method });
  return () => {
    if (component[key] !== method) return;
    if (original) Object.defineProperty(component, key, original);
    else Reflect.deleteProperty(component, key);
  };
}

export function attachSideEditor(
  editor: Editor,
  deps: WidgetDeps,
  getTheme: () => any,
  below: Container,
  native: boolean,
  editorSlot: Container,
) {
  let active = true;
  let gutter = 0;
  let editorWidth = 0;
  let editorHeight = 0;
  let belowHeight = 0;
  let mouseCapture: { offset: number; width: number; height: number } | undefined;
  const baseRender = editor.render;
  const baseMouse = editor.handleMouse;
  const baseGetPadding = editor.getPaddingX;
  const baseSetPadding = editor.setPaddingX;
  let padding = native ? baseGetPadding.call(editor) : 0;

  const render = (width: number) => {
    if (!active) return baseRender.call(editor, width);
    const { animator, config } = deps;
    const frame = animator.getRenderedFrame();
    const avatarWidth = frame?.kind === "text" ? TEXT_CANVAS_COLS : config.size;
    gutter = frame && width >= config.hideBelow && width > avatarWidth + 5 ? avatarWidth + 4 : 0;
    editorWidth = Math.max(1, width - gutter);

    const theme = getTheme();
    const editorLines = baseRender.call(editor, editorWidth);
    editorHeight = editorLines.length;
    const [topBorder, ...content] = editorLines;
    if (native && content[0]?.startsWith(" ")) content[0] = theme.fg("accent", "❯") + content[0].slice(1);
    const belowLines = below.render(editorWidth);
    belowHeight = belowLines.length;
    content.push(...belowLines);
    if (!gutter || !frame) return editorHeight ? [topBorder, ...content] : content;

    const thinkingLevel = deps.pi.getThinkingLevel?.() ?? "high";
    const thinking = theme.getThinkingBorderColor?.(thinkingLevel) ?? ((s: string) => theme.fg("border", s));
    const border = colorStyler(config.theme.border ?? "thinking-level-color", thinking, theme);
    const separator = colorStyler(config.theme["vertical-separator"] ?? "thinking-level-color", thinking, theme);
    const lines = renderFrame(frame, width, config, content, separator);
    const pad = " ".repeat(avatarWidth + 2) + separator("│") + " ";
    while (lines.length < content.length) lines.push(pad + content[lines.length]);
    return editorHeight ? [border("─".repeat(gutter)) + topBorder, ...lines] : lines;
  };
  const handleMouse = (event: TuiMouseEvent) => {
    if (!active || !editorWidth) return baseMouse.call(editor, event);
    if (!mouseCapture && (event.x < gutter || event.y >= editorHeight)) return;
    const offset = mouseCapture?.offset ?? gutter;
    const width = mouseCapture?.width ?? editorWidth;
    const height = mouseCapture?.height ?? Math.min(editorHeight, event.height);
    const result = baseMouse.call(editor, { ...event, x: event.x - offset, width, height });
    if (event.type === "press" && result?.capture) mouseCapture = { offset, width, height };
    if (event.type === "release") mouseCapture = undefined;
    return result;
  };
  // Pi copies the native editor's configured padding when installing a custom editor.
  const getPaddingX = () => active ? padding : baseGetPadding.call(editor);
  const setPaddingX = (value: number) => {
    padding = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    baseSetPadding.call(editor, active ? Math.max(2, padding) : padding);
  };

  // Route below-editor clicks from the slot so interactive widgets retain their own focus target.
  const baseSlotMouse = editorSlot.handleMouse;
  const handleSlotMouse = (event: TuiMouseEvent) => {
    const y = event.y - editorHeight;
    if (active && event.x >= gutter && event.y < event.height && y >= 0 && y < belowHeight) {
      return below.handleMouse({ ...event, x: event.x - gutter, y, width: editorWidth, height: belowHeight });
    }
    return baseSlotMouse.call(editorSlot, event);
  };
  const restoreRender = replaceMethod(editor, "render", render);
  const restoreMouse = replaceMethod(editor, "handleMouse", handleMouse);
  const restoreSlotMouse = replaceMethod(editorSlot, "handleMouse", handleSlotMouse);
  const restoreGetPadding = native ? replaceMethod(editor, "getPaddingX", getPaddingX) : undefined;
  const restoreSetPadding = native ? replaceMethod(editor, "setPaddingX", setPaddingX) : undefined;
  if (!restoreRender || !restoreMouse || !restoreSlotMouse || (native && (!restoreGetPadding || !restoreSetPadding))) {
    restoreRender?.();
    restoreMouse?.();
    restoreSlotMouse?.();
    restoreGetPadding?.();
    restoreSetPadding?.();
    return;
  }
  if (restoreSetPadding) setPaddingX(padding);

  return {
    isAttached: () => editor.render === render && editor.handleMouse === handleMouse
      && editorSlot.handleMouse === handleSlotMouse
      && (!native || (editor.getPaddingX === getPaddingX && editor.setPaddingX === setPaddingX)),
    dispose() {
      active = false;
      restoreRender();
      restoreMouse();
      restoreSlotMouse();
      restoreGetPadding?.();
      if (editor.setPaddingX === setPaddingX) baseSetPadding.call(editor, padding);
      restoreSetPadding?.();
    },
  };
}

function attachBelowEditor(widgets: Container, footer: Container) {
  const component = new Container();
  const restores: (() => void)[] = [];
  const dispose = () => { for (const restore of restores) restore(); };
  // Pi continues to own the slots and can replace their children at any time.
  for (const slot of [widgets, footer]) {
    const baseRender = slot.render.bind(slot);
    const hide = (width: number): string[] => slot.render === hide ? [] : baseRender(width);
    const restore = replaceMethod(slot, "render", hide);
    if (!restore) {
      dispose();
      return;
    }
    restores.push(restore);
    component.addChild({
      render: (width) => slot.render === hide ? baseRender(width) : [],
      handleMouse: (event) => slot.handleMouse(event),
      invalidate() {},
    });
  }
  return { component, dispose };
}

export function createSideWidgetFactory(deps: WidgetDeps, isNativeEditor: () => boolean, getTheme: () => any) {
  const fallbackFactory = createWidgetFactory(deps);
  return (tui: TUI, theme: any) => {
    const fallback = fallbackFactory(tui, theme);
    let editor: Component | undefined;
    let side: ReturnType<typeof attachSideEditor>;
    let below: ReturnType<typeof attachBelowEditor>;
    const detach = () => {
      side?.dispose();
      side = undefined;
      below?.dispose();
      below = undefined;
    };

    const widget = {
      render(width: number): string[] {
        // shortcut: Pi mounts the editor, below-editor widgets, and footer after the above-editor widget slot.
        const slots = tui.children;
        const widgetIndex = slots.findIndex((slot) => slot instanceof Container && slot.children.includes(widget));
        const editorSlot = widgetIndex < 0 ? undefined : slots[widgetIndex + 1];
        const current = editorSlot instanceof Container && editorSlot.children.length === 1 ? editorSlot.children[0] : undefined;
        if (current !== editor) {
          detach();
          editor = current;
          const widgetsBelow = slots[widgetIndex + 2];
          const footer = slots[widgetIndex + 3];
          if (current instanceof Editor && editorSlot instanceof Container && widgetsBelow instanceof Container && footer instanceof Container) {
            below = attachBelowEditor(widgetsBelow, footer);
            if (below) {
              // Pi and other extensions wire callbacks to this instance.
              side = attachSideEditor(current, deps, getTheme, below.component, isNativeEditor(), editorSlot);
              if (!side) detach();
            }
          }
        }
        if (side && !side.isAttached()) detach();
        return side ? [] : fallback.render(width);
      },
      invalidate: fallback.invalidate,
      dispose() {
        detach();
        fallback.dispose();
      },
    };
    return widget;
  };
}
