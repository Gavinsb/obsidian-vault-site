/**
 * S7-10 hook: `+` / drag gutter, and S7-11 hook: drag-and-drop reorder.
 *
 * Both are CM6 view plugins, so the gutter is painted as decorations in the
 * editor's reserved left margin and drag/drop is a text-range splice routed
 * through {@link moveBlocks} (one transaction). The document itself is never
 * rewritten by the gutter — it only exists on screen.
 */
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { detectBlocks, type BlockRange, type BlockType } from "../../shared/block-detect";
import { dropZoneAt, outermostBlocks, type DropZone } from "../../shared/block-manipulation";
import { moveBlocks } from "./editor-actions";

export interface GutterSpec {
  line: number;
  start: number;
  end: number;
  type: BlockType;
  label: string;
}

export interface GutterHandlers {
  onInsertBelow?: (view: EditorView, block: BlockRange) => void;
}

const BLOCK_LABELS: Partial<Record<BlockType, string>> = {
  paragraph: "Paragraph",
  heading: "Heading",
  list: "List",
  listItem: "List item",
  task: "Task",
  quote: "Quote",
  callout: "Callout",
  fence: "Code block",
  table: "Table",
  frontmatter: "Properties",
  agent: "Agent block",
  embed: "Embed",
  hr: "Divider",
};

/** One gutter entry per outermost block, keyed to its first line. */
export function gutterSpecs(state: EditorState): GutterSpec[] {
  const source = state.doc.toString();
  const out: GutterSpec[] = [];
  const seen = new Set<number>();
  for (const block of outermostBlocks(detectBlocks(source))) {
    const line = state.doc.lineAt(block.start).number;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push({
      line,
      start: block.start,
      end: block.end,
      type: block.type,
      label: BLOCK_LABELS[block.type] ?? block.type,
    });
  }
  return out;
}

export interface DragState {
  dragging: BlockRange | null;
  drop: { block: BlockRange; zone: DropZone } | null;
}

export const setBlockDrag = StateEffect.define<BlockRange | null>();
export const setDropTarget = StateEffect.define<{ block: BlockRange; zone: DropZone } | null>();

const dragStateField = StateField.define<DragState>({
  create: () => ({ dragging: null, drop: null }),
  update(value, tr) {
    let dragging = value.dragging;
    let drop = value.drop;
    let changed = false;
    for (const effect of tr.effects) {
      if (effect.is(setBlockDrag)) {
        dragging = effect.value;
        drop = null;
        changed = true;
      } else if (effect.is(setDropTarget)) {
        drop = effect.value;
        changed = true;
      }
    }
    if (changed) return { dragging, drop };
    if (tr.docChanged) return { dragging: null, drop: null };
    return value;
  },
});

export function activeDrag(view: EditorView): DragState {
  return view.state.field(dragStateField, false) ?? { dragging: null, drop: null };
}

let handlers: GutterHandlers = {};

class BlockGutterWidget extends WidgetType {
  constructor(readonly spec: GutterSpec) {
    super();
  }

  eq(other: BlockGutterWidget): boolean {
    return (
      other.spec.start === this.spec.start &&
      other.spec.end === this.spec.end &&
      other.spec.type === this.spec.type
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-block-gutter";
    wrap.setAttribute("contenteditable", "false");
    wrap.dataset.blockStart = String(this.spec.start);
    wrap.dataset.blockEnd = String(this.spec.end);
    wrap.dataset.blockType = this.spec.type;

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "cm-block-plus";
    plus.setAttribute("aria-label", "Insert block below");
    plus.title = `Insert block below (${this.spec.label})`;
    plus.textContent = "+";
    plus.addEventListener("mousedown", (event) => event.preventDefault());
    plus.addEventListener("click", (event) => {
      event.preventDefault();
      const block = blockFromSpec(view, this.spec);
      if (block) handlers.onInsertBelow?.(view, block);
    });

    const drag = document.createElement("span");
    drag.className = "cm-block-drag";
    drag.setAttribute("role", "button");
    drag.setAttribute("tabindex", "-1");
    drag.setAttribute("aria-label", "Drag to move block");
    drag.setAttribute("draggable", "true");
    drag.title = `Drag to move (${this.spec.label})`;
    drag.textContent = "⠿";
    drag.addEventListener("dragstart", (event) => {
      const block = blockFromSpec(view, this.spec);
      if (!block) return;
      const transfer = (event as DragEvent).dataTransfer;
      transfer?.setData("text/plain", String(block.start));
      if (transfer) transfer.effectAllowed = "move";
      view.dispatch({ effects: setBlockDrag.of(block) });
    });
    drag.addEventListener("dragend", () => {
      view.dispatch({ effects: [setDropTarget.of(null), setBlockDrag.of(null)] });
    });

    wrap.append(plus, drag);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function blockFromSpec(view: EditorView, spec: GutterSpec): BlockRange | null {
  const source = view.state.doc.toString();
  return (
    detectBlocks(source).find(
      (block) => block.start === spec.start && block.end === spec.end,
    ) ?? null
  );
}

/** Paint the gutter, the drag ghost and the drop line without touching text. */
export function buildAffordanceDecorations(state: EditorState, drag: DragState): DecorationSet {
  const source = state.doc.toString();
  const ranges: Range<Decoration>[] = [];
  for (const spec of gutterSpecs(state)) {
    const line = state.doc.line(spec.line);
    ranges.push(
      Decoration.widget({ widget: new BlockGutterWidget(spec), side: -1 }).range(line.from),
    );
  }
  const lastLine = state.doc.lines;
  if (drag.dragging) {
    const fromLine = state.doc.lineAt(Math.max(0, Math.min(drag.dragging.start, source.length))).number;
    const toLine = state.doc.lineAt(Math.max(0, Math.min(drag.dragging.end, source.length))).number;
    for (let line = fromLine; line <= Math.min(toLine, lastLine); line++) {
      ranges.push(Decoration.line({ class: "cm-block-ghost" }).range(state.doc.line(line).from));
    }
  }
  if (drag.drop) {
    const boundary =
      drag.drop.zone === "after"
        ? state.doc.lineAt(Math.max(0, Math.min(drag.drop.block.end, source.length))).number
        : state.doc.lineAt(drag.drop.block.start).number;
    const line = Math.min(Math.max(boundary, 1), lastLine);
    ranges.push(
      Decoration.line({ class: `cm-block-drop-line zone-${drag.drop.zone}` }).range(
        state.doc.line(line).from,
      ),
    );
  }
  return Decoration.set(ranges, true);
}

const affordanceField = StateField.define<DecorationSet>({
  create: (state) => buildAffordanceDecorations(state, { dragging: null, drop: null }),
  update(value, tr) {
    if (tr.docChanged || tr.effects.length > 0) {
      return buildAffordanceDecorations(tr.state, tr.state.field(dragStateField));
    }
    if (tr.selection) return value;
    return value;
  },
});

function targetAt(view: EditorView, pos: number) {
  const source = view.state.doc.toString();
  return dropZoneAt(source, pos, detectBlocks(source));
}

const dragDropPlugin = ViewPlugin.fromClass(class {}, {
  eventHandlers: {
    dragover(event, view) {
      const drag = activeDrag(view);
      if (!drag.dragging) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const target = targetAt(view, pos);
      if (!target) return false;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const current = drag.drop;
      if (
        current &&
        current.block.start === target.block.start &&
        current.zone === target.zone
      ) {
        return true;
      }
      view.dispatch({ effects: setDropTarget.of(target) });
      return true;
    },
    drop(event, view) {
      const drag = activeDrag(view);
      if (!drag.dragging || !drag.drop) return false;
      event.preventDefault();
      moveBlocks(view, [drag.dragging], drag.drop.block, drag.drop.zone, [
        setDropTarget.of(null),
        setBlockDrag.of(null),
      ]);
      return true;
    },
    dragend(_event, view) {
      const drag = activeDrag(view);
      if (!drag.dragging && !drag.drop) return false;
      view.dispatch({ effects: [setDropTarget.of(null), setBlockDrag.of(null)] });
      return false;
    },
  },
});

export interface SelectionInfo {
  from: number;
  to: number;
  top: number;
  left: number;
}

/** Viewport position of the selection relative to the editor frame. */
export function measureSelection(view: EditorView): SelectionInfo | null {
  const range = view.state.selection.main;
  if (range.empty) return null;
  const rect = view.dom.getBoundingClientRect();
  let coords: { top: number; left: number } | null = null;
  try {
    coords = view.coordsAtPos(range.from);
  } catch {
    coords = null;
  }
  return {
    from: range.from,
    to: range.to,
    top: (coords?.top ?? rect.top) - rect.top,
    left: (coords?.left ?? rect.left) - rect.left,
  };
}

/** Viewport position of a caret/offset relative to the editor frame. */
export function caretAnchor(view: EditorView, pos: number): { top: number; left: number } {
  const rect = view.dom.getBoundingClientRect();
  let coords: { top: number; left: number } | null = null;
  try {
    coords = view.coordsAtPos(pos);
  } catch {
    coords = null;
  }
  return {
    top: (coords?.top ?? rect.top) - rect.top,
    left: (coords?.left ?? rect.left) - rect.left,
  };
}

/** Report selection changes to the host so it can show the bubble toolbar. */
export function selectionReporter(report: (info: SelectionInfo | null) => void): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged && !update.geometryChanged) return;
    report(measureSelection(update.view));
  });
}

export interface BlockAffordancesOptions extends GutterHandlers {}

export function blockAffordances(options: BlockAffordancesOptions = {}): Extension {
  handlers = { onInsertBelow: options.onInsertBelow };
  return [
    dragStateField,
    affordanceField,
    EditorView.decorations.from(affordanceField),
    dragDropPlugin,
  ];
}
