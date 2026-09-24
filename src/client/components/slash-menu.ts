/**
 * S7-10 — CM6 slash-menu extension.
 *
 * State lives in a CM6 `StateField`: the trigger is derived from the document
 * and caret (`resolveSlashTrigger`), so typing `/` at an empty block start
 * opens the menu and any further typing filters it. The keymap implements the
 * `CommandPalette` keyboard contract; accepting an item dispatches exactly one
 * transaction with a single text-range splice.
 */
import {
  StateEffect,
  StateField,
  Prec,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import {
  SCAFFOLDS,
  filterScaffolds,
  resolveSlashTrigger,
  scaffoldInsertion,
  type Scaffold,
  type ScaffoldContext,
} from "../../shared/slash-menu";

export interface SlashState {
  from: number;
  to: number;
  query: string;
  selected: number;
}

export const setSlashState = StateEffect.define<SlashState | null>();

/** Menu registry + scaffold context. Single editor instance per page. */
let registry: readonly Scaffold[] = SCAFFOLDS;
let contextProvider: () => ScaffoldContext = () => ({});

export function slashItems(query: string): Scaffold[] {
  return filterScaffolds(query, registry);
}

function derive(state: EditorState, previous: SlashState | null): SlashState | null {
  const head = state.selection.main.head;
  if (!state.selection.main.empty) return null;
  const trigger = resolveSlashTrigger(state.doc.toString(), head);
  if (!trigger) return null;
  const count = slashItems(trigger.query).length;
  const selected =
    previous && previous.query === trigger.query
      ? Math.min(previous.selected, Math.max(count - 1, 0))
      : 0;
  return { ...trigger, selected };
}

export const slashStateField = StateField.define<SlashState | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSlashState)) return effect.value;
    }
    if (tr.docChanged || tr.selection) return derive(tr.state, value);
    return value;
  },
});

export function activeSlash(view: EditorView): SlashState | null {
  return view.state.field(slashStateField, false) ?? null;
}

export function slashMove(view: EditorView, delta: number): boolean {
  const state = activeSlash(view);
  if (!state) return false;
  const count = slashItems(state.query).length;
  const selected = Math.max(0, Math.min(state.selected + delta, Math.max(count - 1, 0)));
  view.dispatch({ effects: setSlashState.of({ ...state, selected }) });
  return true;
}

/**
 * Accept the scaffold at `index` (default: the highlighted row). One
 * transaction: splice the `/query` token, place the caret, close the menu.
 */
export function slashSelect(view: EditorView, index?: number, ctx?: ScaffoldContext): boolean {
  const state = activeSlash(view);
  if (!state) return false;
  const items = slashItems(state.query);
  const item = items[index ?? state.selected];
  if (!item) {
    view.dispatch({ effects: setSlashState.of(null) });
    return true;
  }
  const insertion = scaffoldInsertion(item.id, ctx ?? contextProvider());
  if (!insertion) return false;
  view.dispatch({
    changes: { from: state.from, to: state.to, insert: insertion.text },
    selection: { anchor: state.from + insertion.caretOffset },
    annotations: isolateHistory.of("full"),
    effects: setSlashState.of(null),
    scrollIntoView: true,
  });
  return true;
}

export function slashClose(view: EditorView): boolean {
  if (!activeSlash(view)) return false;
  view.dispatch({ effects: setSlashState.of(null) });
  return true;
}

const slashKeymap = Prec.high(
  keymap.of([
    { key: "ArrowDown", run: (view) => slashMove(view, 1) },
    { key: "ArrowUp", run: (view) => slashMove(view, -1) },
    { key: "Enter", run: (view) => slashSelect(view) },
    { key: "Tab", run: (view) => slashSelect(view) },
    { key: "Escape", run: (view) => slashClose(view) },
  ]),
);

export interface SlashMenuOptions {
  scaffolds?: readonly Scaffold[];
  context?: () => ScaffoldContext;
}

/** Report the slash state to the host on every transaction. */
export function slashReporter(report: (state: SlashState | null) => void): Extension {
  return EditorView.updateListener.of((update) => {
    report(update.state.field(slashStateField, false) ?? null);
  });
}

/** The extension to append to the editor's extension list. */
export function slashMenuExtension(options: SlashMenuOptions = {}): Extension {
  if (options.scaffolds) registry = options.scaffolds;
  if (options.context) contextProvider = options.context;
  return [slashStateField, slashKeymap];
}
