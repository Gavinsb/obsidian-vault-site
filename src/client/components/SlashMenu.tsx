/**
 * S7-10 — slash menu overlay.
 *
 * Display + mouse only. The keyboard contract lives in
 * `CommandPalette.paletteKeyIntent()` and is driven by the CM6 keymap, so the
 * menu never fights the editor for keys; `SlashMenu` just renders the filtered
 * scaffolds and reports clicks.
 */
import type { Scaffold } from "../../shared/slash-menu";

export interface SlashMenuProps {
  items: Scaffold[];
  selected: number;
  query: string;
  top: number;
  left: number;
  onSelect: (index: number) => void;
  onHover?: (index: number) => void;
}

export function SlashMenu({
  items,
  selected,
  query,
  top,
  left,
  onSelect,
  onHover,
}: SlashMenuProps) {
  return (
    <div
      className="slash-menu"
      role="listbox"
      aria-label="Insert block"
      data-query={query}
      style={{ top: `${top}px`, left: `${left}px` }}
      // Keep the editor's selection/caret alive while clicking an item.
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.length === 0 && <div className="slash-menu-empty">No matches</div>}
      {items.map((item, index) => (
        <div
          key={item.id}
          id={`slash-option-${item.id}`}
          role="option"
          aria-selected={index === selected}
          className={`slash-menu-item${index === selected ? " active" : ""}`}
          onMouseEnter={() => onHover?.(index)}
          onClick={() => onSelect(index)}
        >
          <span className="slash-menu-label">{item.label}</span>
          <span className="slash-menu-meta">
            <span className="slash-menu-cat">{item.category}</span>
            <span className="slash-menu-hint mono">{item.hint}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
