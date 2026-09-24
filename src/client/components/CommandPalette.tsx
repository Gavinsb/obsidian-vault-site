import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type VaultDocSummary } from '../api';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * S7-10 — the shared palette keyboard contract.
 *
 * `CommandPalette` and the editor's slash menu are the same interaction, so
 * they resolve keys through one pure function: ↑/↓ move, Enter (or Tab)
 * accepts, Escape dismisses. Keeping it here means the two menus can never
 * drift apart.
 */
export interface PaletteKeyState {
  count: number;
  selected: number;
}

export type PaletteKeyIntent =
  | { type: "move"; selected: number }
  | { type: "select"; selected: number }
  | { type: "close" }
  | { type: "none" };

export function paletteKeyIntent(
  key: string,
  state: PaletteKeyState,
): PaletteKeyIntent {
  const { count, selected } = state;
  if (key === "ArrowDown" || key === "Down") {
    return { type: "move", selected: Math.min(selected + 1, Math.max(count - 1, 0)) };
  }
  if (key === "ArrowUp" || key === "Up") {
    return { type: "move", selected: Math.max(selected - 1, 0) };
  }
  if (key === "Enter" || key === "Tab") {
    return count > 0 ? { type: "select", selected } : { type: "close" };
  }
  if (key === "Escape") return { type: "close" };
  return { type: "none" };
}

export function CommandPalette({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<VaultDocSummary[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
    api.docs().then(setDocs).catch(() => {});
  }, []);

  const filteredCommands: Command[] = [
    {
      id: 'new',
      label: 'New note',
      hint: 'Create a document',
      run: () => {
        window.dispatchEvent(new CustomEvent('kv:new-note'));
        onClose();
      },
    },
    {
      id: 'search',
      label: 'Search vault',
      hint: 'Open search',
      run: () => {
        navigate('/search');
        onClose();
      },
    },
    {
      id: 'graph',
      label: 'Open knowledge graph',
      run: () => {
        navigate('/graph');
        onClose();
      },
    },
    {
      id: 'knowledge-map',
      label: 'Open Knowledge Map',
      hint: 'Rank important, neglected, central, and emerging notes',
      run: () => {
        navigate('/knowledge-map');
        onClose();
      },
    },
    {
      id: 'changes',
      label: 'Recent changes',
      run: () => {
        navigate('/changed');
        onClose();
      },
    },
    {
      id: 'health',
      label: 'Knowledge health',
      run: () => {
        navigate('/health');
        onClose();
      },
    },
  ];

  const filteredDocs = docs
    .filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 20)
    .map<Command>((d) => ({
      id: d.relPath,
      label: d.title,
      hint: d.folder,
      run: () => {
        onOpen(d.relPath);
        onClose();
      },
    }));

  const combined = [...filteredCommands, ...filteredDocs];

  const onKey = (e: React.KeyboardEvent) => {
    const intent = paletteKeyIntent(e.key, { count: combined.length, selected: sel });
    if (intent.type === "none") return;
    e.preventDefault();
    if (intent.type === "move") setSel(intent.selected);
    else if (intent.type === "select") combined[intent.selected]?.run();
    else onClose();
  };

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command or doc name…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
        />
        <div className="palette-list">
          {combined.map((c, i) => (
            <div
              key={c.id}
              className={`palette-item${i === sel ? ' active' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={c.run}
            >
              <span>{c.label}</span>
              {c.hint && <span className="muted">{c.hint}</span>}
            </div>
          ))}
          {combined.length === 0 && <div className="muted palette-empty">No matches</div>}
        </div>
      </div>
    </div>
  );
}