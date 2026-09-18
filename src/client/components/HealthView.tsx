import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { HealthIssue } from '../api';
import { api } from '../api';

const KIND_LABEL: Record<string, string> = {
  orphan: 'Orphan',
  'broken-link': 'Broken link',
  'no-incoming': 'No incoming links',
  'no-outgoing': 'No outgoing links',
  empty: 'Empty document',
  'duplicate-title': 'Duplicate title',
  'missing-attachment': 'Missing attachment',
  stale: 'Stale',
  minimal: 'Minimal content',
  unrated: 'Unrated',
};

export function HealthView() {
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api.health().then((h) => setIssues(h.issues)).catch(() => {});
  }, []);

  const grouped = issues.reduce<Record<string, HealthIssue[]>>((acc, i) => {
    (acc[i.kind] ??= []).push(i);
    return acc;
  }, {});
  const kinds = Object.keys(grouped).sort();

  const shown = filter === 'all' ? issues : issues.filter((i) => i.kind === filter);

  return (
    <div className="view">
      <h1>Knowledge health</h1>
      <p className="muted">Issues and opportunities for review. Nothing here modifies the vault.</p>

      <div className="chip-row">
        <button className={`chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>
          All ({issues.length})
        </button>
        {kinds.map((k) => (
          <button
            key={k}
            className={`chip${filter === k ? ' on' : ''}`}
            onClick={() => setFilter(k)}
          >
            {KIND_LABEL[k] ?? k} ({grouped[k].length})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="muted">Nothing here. Looking healthy.</p>
      ) : (
        <ul className="note-list">
          {shown.map((i, idx) => (
            <li key={idx} className={`health-item sev-${i.severity}`}>
              {i.relPath ? (
                <Link to={`/note/${encodeURIComponent(i.relPath)}`}>{i.relPath}</Link>
              ) : (
                <strong>{KIND_LABEL[i.kind] ?? i.kind}</strong>
              )}
              <span className="muted">{i.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}