import { FooterComponent } from "@earendil-works/pi-coding-agent";
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
  renderFooter: (width: number) => string[],
  native: boolean,
) {
  let active = true;
  let gutter = 0;
  let editorWidth = 0;
  let editorHeight = 0;
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
    content.push(...renderFooter(editorWidth));
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

  const restoreRender = replaceMethod(editor, "render", render);
  const restoreMouse = replaceMethod(editor, "handleMouse", handleMouse);
  const restoreGetPadding = native ? replaceMethod(editor, "getPaddingX", getPaddingX) : undefined;
  const restoreSetPadding = native ? replaceMethod(editor, "setPaddingX", setPaddingX) : undefined;
  if (!restoreRender || !restoreMouse || (native && (!restoreGetPadding || !restoreSetPadding))) {
    restoreRender?.();
    restoreMouse?.();
    restoreGetPadding?.();
    restoreSetPadding?.();
    return;
  }
  if (restoreSetPadding) setPaddingX(padding);

  return {
    isAttached: () => editor.render === render && editor.handleMouse === handleMouse
      && (!native || (editor.getPaddingX === getPaddingX && editor.setPaddingX === setPaddingX)),
    dispose() {
      active = false;
      restoreRender();
      restoreMouse();
      restoreGetPadding?.();
      if (editor.setPaddingX === setPaddingX) baseSetPadding.call(editor, padding);
      restoreSetPadding?.();
    },
  };
}

function attachNativeFooter(footer: FooterComponent) {
  const baseRender = footer.render.bind(footer);
  const hide = (width: number): string[] => footer.render === hide ? [] : baseRender(width);
  const dispose = replaceMethod(footer, "render", hide);
  if (!dispose) return;
  return { render: (width: number) => footer.render === hide ? baseRender(width) : [], dispose };
}

export function createSideWidgetFactory(deps: WidgetDeps, isNativeEditor: () => boolean, getTheme: () => any) {
  const fallbackFactory = createWidgetFactory(deps);
  return (tui: TUI, theme: any) => {
    const fallback = fallbackFactory(tui, theme);
    let editor: Component | undefined;
    let side: ReturnType<typeof attachSideEditor>;
    let nativeFooter: FooterComponent | undefined;
    let sideFooter: ReturnType<typeof attachNativeFooter>;

    const widget = {
      render(width: number): string[] {
        // shortcut: Pi mounts the editor, below-editor widgets, and footer after the above-editor widget slot.
        const slots = tui.children;
        const widgetIndex = slots.findIndex((slot) => slot instanceof Container && slot.children.includes(widget));
        const editorSlot = widgetIndex < 0 ? undefined : slots[widgetIndex + 1];
        const current = editorSlot instanceof Container && editorSlot.children.length === 1 ? editorSlot.children[0] : undefined;
        if (current !== editor) {
          side?.dispose();
          editor = current;
          side = undefined;
          if (current instanceof Editor) {
            // Pi and other extensions wire callbacks to this instance.
            side = attachSideEditor(current, deps, getTheme, (width) => sideFooter?.render(width) ?? [], isNativeEditor());
          }
        }
        if (side && !side.isAttached()) {
          side.dispose();
          side = undefined;
        }
        const footerSlot = side ? slots[widgetIndex + 3] : undefined;
        const candidate = footerSlot instanceof Container && footerSlot.children.length === 1 ? footerSlot.children[0] : undefined;
        const footer = candidate instanceof FooterComponent && candidate.constructor === FooterComponent ? candidate : undefined;
        if (footer !== nativeFooter) {
          sideFooter?.dispose();
          nativeFooter = footer;
          sideFooter = footer && attachNativeFooter(footer);
        }
        return side ? [] : fallback.render(width);
      },
      invalidate: fallback.invalidate,
      dispose() {
        side?.dispose();
        sideFooter?.dispose();
        fallback.dispose();
      },
    };
    return widget;
  };
}
