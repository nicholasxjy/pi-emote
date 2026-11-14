import { CustomEditor, FooterComponent, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { Container, type Component, type EditorTheme, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { colorStyler, renderFrame, TEXT_CANVAS_COLS, type WidgetDeps } from "./widget.ts";

export function findNativeFooter(tui: TUI): FooterComponent | undefined {
  // shortcut: Pi has no footer getter; use its component tree until one is exposed.
  const components = [...tui.children];
  for (const component of components) {
    if (component instanceof FooterComponent) return component;
    if (component instanceof Container) components.push(...component.children);
  }
  return undefined;
}

export interface SideEditorDeps extends WidgetDeps {
  getTheme: () => any;
  footer?: Component;
}

export class SideEditor extends CustomEditor {
  private deps: SideEditorDeps;
  private gutter = 0;
  private editorWidth = 0;
  private editorHeight = 0;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, deps: SideEditorDeps) {
    super(tui, theme, keybindings, { embedWorkingStatus: true, paddingX: 2 });
    this.deps = deps;
    deps.animator.setTui(tui);
  }

  setPaddingX(padding: number): void {
    super.setPaddingX(padding);
    super.setPaddingX(Math.max(2, this.getPaddingX()));
  }

  render(width: number): string[] {
    const { animator, config } = this.deps;
    const frame = animator.getRenderedFrame();
    const avatarWidth = frame?.kind === "text" ? TEXT_CANVAS_COLS : config.size;
    this.gutter = frame && width >= config.hideBelow && width > avatarWidth + 5 ? avatarWidth + 4 : 0;
    this.editorWidth = Math.max(1, width - this.gutter);

    const theme = this.deps.getTheme();
    const editorLines = super.render(this.editorWidth);
    if (this.editorWidth >= 3) editorLines[1] = theme.fg("accent", "❯") + editorLines[1].slice(1);
    this.editorHeight = editorLines.length;
    const [topBorder, ...content] = editorLines;
    content.push(...(this.deps.footer?.render(this.editorWidth) ?? []));
    if (!this.gutter || !frame) return [topBorder, ...content];

    const thinkingLevel = this.deps.pi.getThinkingLevel?.() ?? "high";
    const thinking = theme.getThinkingBorderColor?.(thinkingLevel) ?? ((s: string) => theme.fg("border", s));
    const border = colorStyler(config.theme.border ?? "thinking-level-color", thinking, theme);
    const separator = colorStyler(config.theme["vertical-separator"] ?? "thinking-level-color", thinking, theme);
    const lines = renderFrame(frame, width, config, content, separator);
    const pad = " ".repeat(avatarWidth + 2) + separator("│") + " ";
    while (lines.length < content.length) lines.push(pad + content[lines.length]);
    return [border("─".repeat(this.gutter)) + topBorder, ...lines];
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.x < this.gutter || event.y >= this.editorHeight) return undefined;
    return super.handleMouse({ ...event, x: event.x - this.gutter, width: this.editorWidth });
  }
}
