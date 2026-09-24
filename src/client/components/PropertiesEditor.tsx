/**
 * S7-8 — structured Properties (frontmatter) editor.
 *
 * A key/value UI matching Obsidian semantics: keys keep their source order,
 * scalar style, inline comments and every untouched byte. Each edit splices
 * only the one value span through `setPropertyValue`, so Properties edits are
 * ordinary draft edits — they flow through DocView's existing Save/ETag/412
 * state machine and round-trip byte-safely. `updated` is server-owned: shown,
 * never editable.
 */
import { useEffect, useMemo, useState } from "react";
import {
  PROPERTY_KEY_RE,
  parseProperties,
  removeProperty,
  setPropertyValue,
  type PropertyRow,
} from "../../shared/properties";

export interface PropertiesEditorProps {
  /** The full document source (frontmatter at the top). */
  source: string;
  /** Receives the spliced source; omitted for a read-only view. */
  onChange?: (next: string) => void;
  readOnly?: boolean;
  className?: string;
  /** Omit the internal "Properties" heading (the host supplies its own). */
  hideHead?: boolean;
}

export function PropertiesEditor({
  source,
  onChange,
  readOnly = false,
  className,
  hideHead = false,
}: PropertiesEditorProps) {
  const parsed = useMemo(() => parseProperties(source), [source]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const disabled = readOnly || !onChange;

  const commit = (key: string, value: string) => {
    if (!onChange) return;
    const next = setPropertyValue(source, key, value);
    // A no-op edit must not dirty the draft.
    if (next !== source) onChange(next);
  };
  const drop = (key: string) => {
    if (!onChange) return;
    const next = removeProperty(source, key);
    if (next !== source) onChange(next);
  };
  const add = () => {
    const key = newKey.trim();
    if (!onChange || !PROPERTY_KEY_RE.test(key)) return;
    const next = setPropertyValue(source, key, newValue);
    if (next !== source) {
      onChange(next);
      setNewKey("");
      setNewValue("");
    }
  };

  return (
    <section
      className={`properties-editor${className ? ` ${className}` : ""}`}
      aria-label="Note properties"
    >
      {!hideHead && (
        <div className="properties-head">
          <h4>Properties</h4>
          {!parsed.hasFrontmatter && (
            <span className="properties-hint muted">
              No frontmatter yet — add a property to create one.
            </span>
          )}
        </div>
      )}
      <div className="properties-rows">
        {parsed.rows.length === 0 && (
          <p className="properties-empty muted">No properties.</p>
        )}
        {parsed.rows.map((row) => (
          <PropertyRowView
            key={`${row.start}-${row.key}`}
            row={row}
            disabled={disabled}
            onCommit={(value) => commit(row.key, value)}
            onRemove={disabled || row.readOnly ? undefined : () => drop(row.key)}
          />
        ))}
      </div>
      {!disabled && (
        <div className="properties-add">
          <input
            className="property-key-input mono"
            placeholder="key"
            aria-label="New property key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <input
            className="property-value-input"
            placeholder="value"
            aria-label="New property value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <button
            className="properties-add-button"
            onClick={add}
            disabled={!PROPERTY_KEY_RE.test(newKey.trim())}
          >
            Add
          </button>
        </div>
      )}
    </section>
  );
}

function PropertyRowView({
  row,
  disabled,
  onCommit,
  onRemove,
}: {
  row: PropertyRow;
  disabled: boolean;
  onCommit: (value: string) => void;
  onRemove?: () => void;
}) {
  const editable = row.editable && !disabled;
  return (
    <div
      className={`property-row${row.readOnly ? " property-readonly" : ""}${row.editable ? "" : " property-locked"}`}
      data-property-key={row.key}
      data-property-kind={row.kind}
    >
      <span className="property-key mono" title={row.key}>
        {row.key}
      </span>
      {editable ? (
        <PropertyValueInput row={row} onCommit={onCommit} />
      ) : (
        <span
          className="property-value property-value-static mono"
          aria-readonly="true"
          title={row.readOnly ? "Server-owned property" : "Nested/block value"}
        >
          {row.raw.slice(row.raw.indexOf(":") + 1).trimStart() || "—"}
        </span>
      )}
      {row.comment && <span className="property-comment muted">{row.comment}</span>}
      {row.readOnly && <span className="property-badge">server-owned</span>}
      {onRemove && (
        <button
          className="property-remove"
          aria-label={`Remove property ${row.key}`}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * The input keeps its own text while focused so re-encoding (quoting a value
 * that needs it) never fights the caret; the committed value is spliced into
 * the source on every change.
 */
function PropertyValueInput({
  row,
  onCommit,
}: {
  row: PropertyRow;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(row.value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(row.value);
  }, [row.value, focused]);
  return (
    <input
      className="property-value-input"
      aria-label={`Value of ${row.key}`}
      data-property-input={row.key}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(e.target.value);
      }}
    />
  );
}
