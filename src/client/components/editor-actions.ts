/**
 * S7-10 / S7-11 — the single write path for every block/flat manipulation.
 *
 * Each exported action dispatches **exactly one** CM6 transaction and annotates
 * it with `isolateHistory` so native undo restores the exact source in one
 * step. Nothing here ever touches the host's draft/baseline/ETag machine: the
 * transaction just changes the document, and the existing `onChange` plumbing
 * carries the new markdown out of the editor.
 */
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { StateEffect } from "@codemirror/state";
import { detectBlocks, type BlockRange } from "../../shared/block-detect";
import {
  blocksInRange,
  planDeleteBlocks,
  planDuplicateBlocks,
  planInsertBelow,
  planReorder,
  planTurnIntoBlocks,
  selectionSpan,
  type BlockChange,
  type DropZone,
  type TurnIntoId,
} from "../../shared/block-manipulation";
import { applyInlineMark, type InlineMark } from "../../shared/inline-marks";
import type { ScaffoldContext } from "../../shared/slash-menu";

function orderedChanges(changes: readonly BlockChange[]) {
  return [...changes]
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map((change) => ({ from: change.from, to: change.to, insert: change.insert }));
}

/** Dispatch one isolated transaction for a planned change set. */
export function runBlockChanges(
  view: EditorView,
  changes: readonly BlockChange[],
  cursor?: number,
  effects: readonly StateEffect<unknown>[] = [],
): boolean {
  if (changes.length === 0) return false;
  view.dispatch({
    changes: orderedChanges(changes),
    selection: cursor === undefined ? undefined : { anchor: cursor },
    annotations: isolateHistory.of("full"),
    effects: [...effects],
    scrollIntoView: true,
  });
  return true;
}

/** Gutter `+`: insert an empty block directly below `block`. */
export function insertBlockBelow(view: EditorView, block: BlockRange): boolean {
  return runBlockChanges(view, planInsertBelow(block, "\n"), block.end + 1);
}

export function deleteBlocks(view: EditorView, blocks: readonly BlockRange[]): boolean {
  return runBlockChanges(view, planDeleteBlocks(blocks));
}

export function duplicateBlocks(view: EditorView, blocks: readonly BlockRange[]): boolean {
  return runBlockChanges(
    view,
    planDuplicateBlocks(view.state.doc.toString(), blocks),
  );
}

export function turnIntoBlocks(
  view: EditorView,
  blocks: readonly BlockRange[],
  target: TurnIntoId,
  ctx: ScaffoldContext = {},
): boolean {
  return runBlockChanges(
    view,
    planTurnIntoBlocks(view.state.doc.toString(), blocks, target, ctx),
  );
}

/** Drag-and-drop: before / after / nest only (never a two-column drop). */
export function moveBlocks(
  view: EditorView,
  moving: readonly BlockRange[],
  target: BlockRange,
  zone: DropZone,
  effects: readonly StateEffect<unknown>[] = [],
): boolean {
  return runBlockChanges(
    view,
    planReorder(view.state.doc.toString(), moving, target, zone),
    undefined,
    effects,
  );
}

/** Apply an inline mark to the current selection (one splice / one transaction). */
export function applyInlineMarkToView(
  view: EditorView,
  mark: InlineMark,
  value?: string,
): boolean {
  const range = view.state.selection.main;
  const result = applyInlineMark(
    view.state.doc.toString(),
    { anchor: range.anchor, head: range.head },
    mark,
    value,
  );
  if (!result) return false;
  view.dispatch({
    changes: { from: result.from, to: result.to, insert: result.insert },
    selection: { anchor: result.anchor, head: result.head },
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  });
  return true;
}

/** The block whose outermost range starts at `start`, or null. */
export function blockAt(source: string, start: number): BlockRange | null {
  return detectBlocks(source).find((block) => block.start === start) ?? null;
}

/** Outermost blocks touched by the current selection (multi-block bulk ops). */
export function selectionBlocks(view: EditorView): BlockRange[] {
  const range = view.state.selection.main;
  return blocksInRange(
    detectBlocks(view.state.doc.toString()),
    range.from,
    range.to,
  );
}

/** Snap the selection to whole block boundaries. */
export function snapSelectionToBlocks(view: EditorView): boolean {
  const range = view.state.selection.main;
  const span = selectionSpan(detectBlocks(view.state.doc.toString()), range.from, range.to);
  if (!span) return false;
  view.dispatch({
    selection: { anchor: span.anchor, head: span.head },
    annotations: isolateHistory.of("full"),
  });
  return true;
}

/** Bulk actions operate on every block the selection touches. */
export function bulkDeleteBlocks(view: EditorView): boolean {
  return deleteBlocks(view, selectionBlocks(view));
}

export function bulkDuplicateBlocks(view: EditorView): boolean {
  return duplicateBlocks(view, selectionBlocks(view));
}
