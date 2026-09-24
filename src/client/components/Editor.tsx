/**
 * S7-5 — CodeMirror 6 editor core.
 *
 * Replaces the raw `<textarea>` edit surface with the Atomic Editor
 * (CodeMirror 6 + Obsidian-style inline live preview). The component owns
 * exactly three things on top of the wrapped editor:
 *
 *   1. document identity — `documentId ?? path` is passed through so
 *      switching notes tears the view down instead of bleeding a stale
 *      cursor/undo history into the next note;
 *   2. `Ctrl/Cmd+S` → the host's explicit Save (never an auto-save);
 *   3. the unified `/api/completions` endpoint as the completion source
 *      (`resolveCompletionTrigger` + `createCompletionSource` below),
 *      keeping the trigger/suppression/insertion semantics that
 *      `src/shared/editor-utils.ts` established for the textarea.
 *
 * The editor is "uncontrolled" in the CM6 sense: `value` seeds the
 * document at mount and is re-pushed only when the host changes it
 * programmatically (review accept/reject, reload-after-save). Typing
 * flows out through `onChange`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtomicCodeMirrorEditor,
  type AtomicCodeMirrorEditorHandle,
} from "@atomic-editor/editor";
import "@atomic-editor/editor/styles.css";
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  applyAutocomplete,
  findAutocompleteTrigger,
} from "../../shared/editor-utils";
import { api } from "../api";
import { BlockToolbar } from "./BlockToolbar";
import { SlashMenu } from "./SlashMenu";
import {
  blockAffordances,
  caretAnchor,
  measureSelection,
  selectionReporter,
  type SelectionInfo,
} from "./block-affordances";
import {
  slashMenuExtension,
  slashReporter,
  slashSelect,
  type SlashState,
} from "./slash-menu";
import { applyInlineMarkToView, insertBlockBelow } from "./editor-actions";
import { filterScaffolds } from "../../shared/slash-menu";
import type { InlineMark } from "../../shared/inline-marks";

export interface EditorProps {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  path?: string;
  documentId?: string;
  onSave?: () => void;
  className?: string;
  /**
   * Vault-wide reserved agent IDs (S7-12, carried forward from Wave 6).
   * Threaded into the slash menu's scaffold context so a newly inserted agent
   * instruction/review never collides with an existing block or the sweep log.
   * Only the ID seed changes — the scaffold shape stays byte-exact.
   */
  reservedIds?: readonly string[];
  /**
   * Optional imperative handle (`focus`, `undo`, `redo`, `getMarkdown`,
   * `getContentDOM`, …). The host uses it for range navigation such as the
   * agent-staging "Go to source" button.
   */
  editorHandleRef?: React.MutableRefObject<AtomicCodeMirrorEditorHandle | null>;
}

/** Completion kinds served by the unified endpoint (S7-3). */
export type CompletionKind =
  | "note"
  | "tag"
  | "heading"
  | "blockref"
  | "callout";

/** The slice of `api` the completion source needs (injectable for tests). */
export interface CompletionApi {
  completions(
    kind: CompletionKind,
    q: string,
    path?: string,
    limit?: number,
  ): Promise<{
    results: { value: string; detail?: string; score: number }[];
  }>;
}

/** A resolved completion trigger: what to ask for and what to replace. */
export interface CompletionTrigger {
  kind: CompletionKind;
  query: string;
  /** Start of the text the completion replaces (inclusive). */
  from: number;
  /** End of the text the completion replaces (the caret). */
  to: number;
  /** Note name typed after `[[` — heading/block ref targets. */
  note?: string;
}

/** Lezer node names that mean "the caret is inside code, stay quiet". */
const CODE_NODE = /^(FencedCode|CodeBlock|InlineCode|CodeText|Comment)$/;

/**
 * Structural view of a Lezer node. Declared locally (rather than importing
 * `SyntaxNode`) because `@codemirror/language` ships its own nested copy of
 * `@lezer/common`, and the two declarations are not interchangeable.
 */
interface SyntaxAncestor {
  name: string;
  parent: SyntaxAncestor | null;
}

function insideCode(state: EditorState, pos: number): boolean {
  let node: SyntaxAncestor | null = syntaxTree(state).resolveInner(
    pos,
    -1,
  ) as SyntaxAncestor;
  while (node) {
    if (CODE_NODE.test(node.name)) return true;
    node = node.parent;
  }
  return false;
}

/**
 * Resolve the completion trigger at `pos`.
 *
 * `[[` (notes) and `#` (tags) reuse `findAutocompleteTrigger()` verbatim, so
 * the wikilink/tag semantics, code suppression and insertion shape are
 * unchanged. Two trigger families the textarea helper never covered are added
 * here, both native CM6 equivalents:
 *
 *   - `[[Note#` / `[[Note#^` → heading and block-ref completions for that note;
 *   - `> [!` → callout types (static list + vault-observed).
 *
 * Fenced and inline code are suppressed through the Lezer tree rather than the
 * old line scan, so fences nested in lists/quotes are covered too.
 */
export function resolveCompletionTrigger(
  state: EditorState,
  pos: number,
): CompletionTrigger | null {
  const source = state.doc.toString();
  if (pos < 0 || pos > source.length) return null;
  if (insideCode(state, pos)) return null;

  const lineStart = Math.max(source.lastIndexOf("\n", pos - 1) + 1, 0);
  const line = source.slice(lineStart, pos);
  const callout = /^\s*>\s*\[!([A-Za-z-]*)$/.exec(line);
  if (callout) {
    return {
      kind: "callout",
      query: callout[1],
      from: lineStart + line.lastIndexOf("[!") + 2,
      to: pos,
    };
  }

  const base = findAutocompleteTrigger(source, pos);
  if (!base) return null;
  if (base.kind === "tag") {
    return {
      kind: "tag",
      query: base.query,
      from: base.replaceStart,
      to: base.replaceEnd,
    };
  }
  const hash = base.query.indexOf("#");
  if (hash >= 0) {
    const note = base.query.slice(0, hash);
    const rest = base.query.slice(hash + 1);
    const block = rest.startsWith("^");
    return {
      kind: block ? "blockref" : "heading",
      query: block ? rest.slice(1) : rest,
      note,
      // Replace from the opening `[[`, exactly like the note/tag triggers, so
      // the insertion below never duplicates the typed `[[Note#` prefix.
      from: base.replaceStart,
      to: base.replaceEnd,
    };
  }
  return {
    kind: "note",
    query: base.query,
    from: base.replaceStart,
    to: base.replaceEnd,
  };
}

/** Note name typed after `[[` → the vault-relative path the server expects. */
function noteRelPath(note: string, currentPath?: string): string | undefined {
  const name = note.trim();
  if (!name) return currentPath;
  return /\.md$/i.test(name) ? name : `${name}.md`;
}

/**
 * The text a completion inserts. `note` and `tag` go through
 * `applyAutocomplete()` so the insertion form stays byte-identical to the
 * textarea implementation (`[[Note Name]]`, `#tag`); heading/block-ref close
 * their own `]]`, and a callout completion inserts the bare type so the user
 * still writes `] Title` themselves. Only the plain completion value is ever
 * inserted — never agent block content.
 */
export function completionInsertion(
  trigger: CompletionTrigger,
  value: string,
  source: string,
): string {
  if (trigger.kind === "note" || trigger.kind === "tag") {
    const out = applyAutocomplete(
      source,
      {
        kind: trigger.kind === "note" ? "wikilink" : "tag",
        query: trigger.query,
        replaceStart: trigger.from,
        replaceEnd: trigger.to,
      },
      value,
    );
    return out.source.slice(trigger.from, out.cursor);
  }
  if (trigger.kind === "heading") return `[[${trigger.note ?? ""}#${value}]]`;
  if (trigger.kind === "blockref")
    return `[[${trigger.note ?? ""}#^${value}]]`;
  return value;
}

export interface CompletionSourceOptions {
  /** Note being edited — the target for same-note `[[#Heading]]` lookups. */
  path?: string;
  /** Injected for tests; defaults to the real client `api`. */
  api?: CompletionApi;
  /** Debounce before hitting the server. Default 200 ms (as today). */
  debounceMs?: number;
  limit?: number;
}

/**
 * Build a CodeMirror completion source backed by `/api/completions`.
 *
 * Debounced, sequence-guarded and doc-guarded: a response that arrives after
 * the caret moved on, or after a newer request was issued, is dropped. A
 * failed lookup returns `null` — completion never blocks typing.
 */
export function createCompletionSource(options: CompletionSourceOptions = {}) {
  const { path, debounceMs = 200, limit = 8 } = options;
  const completionsApi = options.api ?? api;
  let seq = 0;
  return async function completionSource(
    ctx: CompletionContext,
  ): Promise<CompletionResult | null> {
    const trigger = resolveCompletionTrigger(ctx.state, ctx.pos);
    if (!trigger) return null;
    const id = ++seq;
    const docAtRequest = ctx.state.doc;
    if (debounceMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, debounceMs));
      if (id !== seq) return null; // superseded while debouncing
      if (!ctx.state.doc.eq(docAtRequest)) return null; // document moved on
    }
    const targetPath =
      trigger.kind === "heading" || trigger.kind === "blockref"
        ? noteRelPath(trigger.note ?? "", path)
        : undefined;
    let results: { value: string; detail?: string; score: number }[];
    try {
      const res = await completionsApi.completions(
        trigger.kind,
        trigger.query,
        targetPath,
        limit,
      );
      if (id !== seq) return null; // stale response
      results = res.results ?? [];
    } catch {
      return null;
    }
    if (results.length === 0) return null;
    const source = ctx.state.doc.toString();
    const completions: Completion[] = results.map((r) => ({
      label: r.value,
      detail: r.detail,
      type: trigger.kind,
      apply: completionInsertion(trigger, r.value, source),
    }));
    // `filter: false` keeps the server's ranking exactly as returned.
    return { from: trigger.from, to: trigger.to, options: completions, filter: false };
  };
}

/** Fill the editor frame inside the host's `.editor-pane` box. */
const editorFrameTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
});

/**
 * Select a source range in a mounted editor and scroll it into view — the
 * "Go to source" action of the agent-staging panel. Returns false when the
 * editor isn't mounted (e.g. read mode).
 */
export function selectRange(
  handle: AtomicCodeMirrorEditorHandle | null,
  from: number,
  to: number,
): boolean {
  const dom = handle?.getContentDOM();
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view) return false;
  view.focus();
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  return true;
}

/** True when two slash-menu snapshots describe the same row. */
function sameSlash(a: SlashState | null, b: SlashState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.query === b.query &&
    a.selected === b.selected
  );
}

export function Editor({
  value,
  onChange,
  readOnly = false,
  path,
  documentId,
  onSave,
  className,
  editorHandleRef,
  reservedIds,
}: EditorProps) {
  const internalHandle = useRef<AtomicCodeMirrorEditorHandle | null>(null);
  const handleRef = editorHandleRef ?? internalHandle;
  /**
   * Reserved IDs live in a ref because the extensions array (and therefore the
   * slash-menu context provider) is captured once per document; the ref keeps
   * generation current without tearing the view down on every fetch.
   */
  const reservedIdsRef = useRef<readonly string[]>(reservedIds ?? []);
  useEffect(() => {
    reservedIdsRef.current = reservedIds ?? [];
  }, [reservedIds]);
  /** Last markdown this component either emitted or pushed into the view. */
  const lastKnown = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  /** Bubble toolbar state (S7-10) + the offset the user dismissed it at. */
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const dismissedAt = useRef<number | null>(null);
  /** Slash menu state (S7-10). */
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [slashAnchorPoint, setSlashAnchorPoint] = useState({ top: 0, left: 0 });
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const liveView = useCallback(() => {
    const dom = handleRef.current?.getContentDOM();
    return dom ? EditorView.findFromDOM(dom) : null;
  }, [handleRef]);

  // Stable callbacks for the extensions (they are captured at mount).
  const reportSelection = useRef((info: SelectionInfo | null) => {
    if (info && dismissedAt.current !== null && dismissedAt.current === info.to) return;
    if (info) dismissedAt.current = null;
    setSelection(info);
  });
  const reportSlash = useRef((next: SlashState | null) => {
    setSlash((previous) => (sameSlash(previous, next) ? previous : next));
  });
  const insertBelow = useRef((view: EditorView, block: Parameters<typeof insertBlockBelow>[1]) => {
    insertBlockBelow(view, block);
  });

  // `documentId ?? path` is the document identity: a different note remounts
  // the view (no stale cursor/undo), the same note keeps its state.
  const identity = documentId ?? path;

  // Extensions are captured at mount by the wrapped editor, so keep the array
  // stable per document instead of rebuilding it on every keystroke.
  const extensions = useMemo<Extension[]>(
    () => [
      Prec.high(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              const save = onSaveRef.current;
              if (!save) return false;
              save();
              return true;
            },
          },
        ]),
      ),
      autocompletion({
        override: [createCompletionSource({ path })],
        icons: false,
      }),
      editorFrameTheme,
      // S7-10 / S7-11 — gutter, drag handle, drop zones, slash menu, bubble
      // toolbar reporting. All view-level; none of them rewrite the source.
      blockAffordances({
        onInsertBelow: (view, block) => insertBelow.current(view, block),
      }),
      slashMenuExtension({
        context: () => ({ target: path, reservedIds: reservedIdsRef.current }),
      }),
      slashReporter((next) => reportSlash.current(next)),
      selectionReporter((info) => reportSelection.current(info)),
    ],
    [path],
  );

  // Keep the slash overlay anchored to the caret that opened it.
  useEffect(() => {
    if (!slash) return;
    const view = liveView();
    if (!view) return;
    setSlashAnchorPoint(caretAnchor(view, slash.from));
  }, [slash, liveView]);

  const handleChange = useCallback((next: string) => {
    lastKnown.current = next;
    onChangeRef.current(next);
  }, []);

  // Push host-side draft changes (review accept/reject, reload-after-save)
  // into the live view. Our own keystrokes echo back through `lastKnown`, so
  // this never fires while typing.
  useEffect(() => {
    if (value === lastKnown.current) return;
    lastKnown.current = value;
    const dom = handleRef.current?.getContentDOM();
    const view = dom ? EditorView.findFromDOM(dom) : null;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value, identity, handleRef]);

  return (
    <div className={className ? `editor-wrap ${className}` : "editor-wrap"}>
      <AtomicCodeMirrorEditor
        documentId={identity}
        markdownSource={value}
        readOnly={readOnly}
        onMarkdownChange={handleChange}
        editorHandleRef={handleRef}
        extensions={extensions}
      />
      {!readOnly && selection && (
        <BlockToolbar
          top={selection.top}
          left={selection.left}
          hasSelection={selection.to > selection.from}
          onCommand={(mark: InlineMark, arg?: string) => {
            const view = liveView();
            if (view) {
              applyInlineMarkToView(view, mark, arg);
              dismissedAt.current = null;
              setSelection(measureSelection(view));
            }
          }}
          onClose={() => {
            dismissedAt.current = selection?.to ?? null;
            setSelection(null);
          }}
        />
      )}
      {!readOnly && slash && (
        <SlashMenu
          items={filterScaffolds(slash.query)}
          selected={slash.selected}
          query={slash.query}
          top={slashAnchorPoint.top}
          left={slashAnchorPoint.left}
          onSelect={(index) => {
            const view = liveView();
            if (view) slashSelect(view, index);
          }}
        />
      )}
    </div>
  );
}
