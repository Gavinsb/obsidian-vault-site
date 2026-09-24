/**
 * S8-2 — Raw markdown source editor.
 *
 * A deliberately plain CodeMirror 6 view over the same CM6 packages the
 * WYSIWYG editor uses: markdown syntax highlighting, line numbers, history and
 * find. No live preview, no block gutter, no inline decorations and no agent
 * console — the file exactly as it is written, frontmatter included.
 *
 * Like `Editor`, it is uncontrolled: `value` seeds the document at mount and is
 * re-pushed only when the host changes it programmatically (review accept /
 * reject, reload-after-save). Typing flows out through `onChange`, so the host's
 * draft/baseline/ETag/Save contract is byte-identical to Edit mode.
 */
import { useEffect, useRef } from "react";
import {
  Compartment,
  EditorState,
  Prec,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";

export interface RawEditorProps {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  /** Document identity — switching notes rebuilds the view (no stale undo). */
  path?: string;
  onSave?: () => void;
  className?: string;
}

/** Plain-source styling; keeps the raw pane visually consistent with Edit. */
const rawTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
});

export function RawEditor({
  value,
  onChange,
  readOnly = false,
  path,
  onSave,
  className,
}: RawEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const lastKnown = useRef(value);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Rebuild the view per document identity. `path` is the identity because the
  // raw pane is always the whole file.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
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
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      rawTheme,
      readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const next = update.state.doc.toString();
        lastKnown.current = next;
        onChangeRef.current(next);
      }),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host,
    });
    viewRef.current = view;
    lastKnown.current = value;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // `value` is intentionally a mount-time seed; identity is `path`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Toggle read-only in place (no remount, scroll preserved).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    });
  }, [readOnly]);

  // Push host-side draft changes (reload-after-save) into the live view. Our own
  // keystrokes update `lastKnown`, so this never fires while typing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === lastKnown.current) return;
    lastKnown.current = value;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return (
    <div
      ref={hostRef}
      className={className ? `raw-editor ${className}` : "raw-editor"}
    />
  );
}
