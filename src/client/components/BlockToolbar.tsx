/**
 * S7-10 — selection bubble toolbar.
 *
 * Floats above the current selection with the eight marks the spec lists
 * (bold, italic, strike, code, link, wikilink, highlight, comment). It owns
 * only dismissal + accessibility: Esc and click-away close it, every control
 * is a labelled button inside a `role="toolbar"`, and the actual text splice is
 * performed by the editor (one CM6 transaction).
 */
import { useEffect, useRef, useState } from "react";
import { INLINE_MARKS, type InlineMark, type InlineMarkSpec } from "../../shared/inline-marks";

export interface BlockToolbarProps {
  top: number;
  left: number;
  marks?: readonly InlineMarkSpec[];
  /** True when the editor has a non-empty selection (link/wikilink targets). */
  hasSelection?: boolean;
  onCommand: (mark: InlineMark, value?: string) => void;
  onClose: () => void;
}

export function BlockToolbar({
  top,
  left,
  marks = INLINE_MARKS,
  hasSelection = false,
  onCommand,
  onClose,
}: BlockToolbarProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Esc dismisses from anywhere (the editor keeps keyboard focus).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (linkOpen) setLinkOpen(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [linkOpen, onClose]);

  // Click-away dismissal.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  const run = (mark: InlineMark) => {
    if (mark === "link") {
      setLinkOpen(true);
      return;
    }
    onCommand(mark);
  };

  return (
    <div
      ref={rootRef}
      className="block-toolbar"
      role="toolbar"
      aria-label="Inline formatting"
      aria-orientation="horizontal"
      style={{ top: `${top}px`, left: `${left}px` }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {marks.map((mark) => (
        <button
          key={mark.id}
          type="button"
          className={`block-toolbar-btn mark-${mark.id}`}
          data-mark={mark.id}
          aria-label={mark.aria}
          title={mark.aria}
          aria-pressed={false}
          disabled={mark.needsValue && !hasSelection}
          onClick={() => run(mark.id)}
        >
          {mark.label}
        </button>
      ))}
      {linkOpen && (
        <span className="block-toolbar-link">
          <input
            className="block-toolbar-input"
            aria-label="Link URL"
            placeholder="https://…"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommand("link", url);
                setLinkOpen(false);
                setUrl("");
              }
            }}
          />
        </span>
      )}
    </div>
  );
}
