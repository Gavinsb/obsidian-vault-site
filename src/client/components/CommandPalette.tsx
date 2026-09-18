import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type VaultDocSummary } from '../api';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
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
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, combined.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      combined[sel]?.run();
    } else if (e.key === 'Escape') {
      onClose();
    }
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