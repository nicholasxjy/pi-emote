import { CustomEditor, type KeybindingsManager, type ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type EditorTheme, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { buildInfoLines, colorStyler, renderFrame, TEXT_CANVAS_COLS, type WidgetDeps } from "./widget.ts";

const HIDDEN_BORDER = "\x00pi-emote-border";

export interface SideEditorDeps extends WidgetDeps {
  getTheme: () => any;
  getFooterData: () => ReadonlyFooterDataProvider | undefined;
}

export class SideEditor extends CustomEditor {
  private deps: SideEditorDeps;
  private gutter = 0;
  private editorWidth = 0;
  private editorRows: number[] = [];

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, deps: SideEditorDeps) {
    super(tui, theme, keybindings);
    this.deps = deps;
    deps.animator.setTui(tui);
  }

  protected renderTopBorder(): string {
    return HIDDEN_BORDER;
  }

  protected renderBottomBorder(): string {
    return HIDDEN_BORDER;
  }

  render(width: number): string[] {
    const { animator, config } = this.deps;
    const frame = animator.getRenderedFrame();
    const avatarWidth = frame?.kind === "text" ? TEXT_CANVAS_COLS : config.size;
    this.gutter = frame && width >= config.hideBelow && width > avatarWidth + 5 ? avatarWidth + 4 : 0;
    this.editorWidth = Math.max(1, width - this.gutter);

    // Remove only the border rows; autocomplete is rendered after the bottom border.
    this.editorRows = [];
    const content = super.render(this.editorWidth).filter((line, row) => {
      if (line === HIDDEN_BORDER) return false;
      this.editorRows.push(row);
      return true;
    });
    content.push(...this.renderStatus(this.editorWidth));
    if (!this.gutter || !frame) return content;

    const theme = this.deps.getTheme();
    const thinkingLevel = this.deps.pi.getThinkingLevel?.() ?? "high";
    const thinking = theme.getThinkingBorderColor?.(thinkingLevel) ?? ((s: string) => theme.fg("border", s));
    const separator = colorStyler(config.theme["vertical-separator"] ?? "thinking-level-color", thinking, theme);
    const lines = renderFrame(frame, width, config, content, separator);
    const pad = " ".repeat(avatarWidth + 2) + separator("│") + " ";
    while (lines.length < content.length) lines.push(pad + content[lines.length]);
    return lines;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const row = this.editorRows[event.y];
    if (event.x < this.gutter || row === undefined) return undefined;
    return super.handleMouse({ ...event, x: event.x - this.gutter, y: row, width: this.editorWidth });
  }

  private renderStatus(width: number): string[] {
    const ctx = this.deps.getCtxRef();
    if (!ctx) return [];
    const theme = this.deps.getTheme();
    const info = buildInfoLines(width, ctx, this.deps.pi, theme, this.deps.config);
    const footerData = this.deps.getFooterData();
    const branch = footerData?.getGitBranch();
    const name = ctx.sessionManager.getSessionName?.();
    const usage = ctx.getContextUsage?.();
    const context = usage ? ` ${usage.percent?.toFixed(1) ?? "?"}%` : "";
    const lines = [
      `${info[3]}${branch ? ` (${branch})` : ""}${name ? ` • ${name}` : ""}`,
      `${info[2]}${theme.fg("dim", context)} • ${info[0]}`,
    ];
    const statuses = [...(footerData?.getExtensionStatuses().values() ?? [])];
    if (statuses.length) lines.push(statuses.join(" "));
    return lines.map((line) => truncateToWidth(line.replace(/[\r\n\t]/g, " "), width));
  }
}
