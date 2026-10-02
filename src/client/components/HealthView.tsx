import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  const [loading, setLoading] = useState(true);
  const [params] = useSearchParams();
  const [filter, setFilter] = useState(params.get('kind') ?? 'all');

  useEffect(() => {
    api
      .health()
      .then((h) => setIssues(h.issues))
      .catch(() => {})
      .finally(() => setLoading(false));
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

      <div className="chip-row" role="group" aria-label="Filter issues by kind">
        <button
          className={`chip${filter === 'all' ? ' on' : ''}`}
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          All ({issues.length})
        </button>
        {kinds.map((k) => (
          <button
            key={k}
            className={`chip${filter === k ? ' on' : ''}`}
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
          >
            {KIND_LABEL[k] ?? k} ({grouped[k].length})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="muted">Loading health checks…</p>
      ) : shown.length === 0 ? (
        <p className="muted">Nothing here. Looking healthy.</p>
      ) : (
        <>
          <p className="muted health-summary">
            {new Set(shown.map((i) => i.relPath)).size} files ·{' '}
            {shown.length} issues. Broken links are the only blocking category;
            ratings and orphans are advisory.
          </p>
          <IssueGroups issues={shown} />
        </>
      )}
    </div>
  );
}

/**
 * Group issues by the file they belong to, so a file with 54 broken links is
 * one row ("54 unresolved links") plus a drill-down — not 54 identical rows.
 * Selecting the row reveals the individual issues.
 */
function IssueGroups({ issues }: { issues: HealthIssue[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const byFile = new Map<string, HealthIssue[]>();
  for (const i of issues) {
    const key = i.relPath || `\u0000${KIND_LABEL[i.kind] ?? i.kind}`;
    (byFile.get(key) ?? byFile.set(key, []).get(key)!).push(i);
  }
  const sevRank = (s: string) =>
    s === 'critical' ? 0 : s === 'warn' ? 1 : 2;
  const groupSev = (list: HealthIssue[]) =>
    Math.min(...list.map((i) => sevRank(i.severity)));
  // Most severe first, then by number of issues.
  const groups = [...byFile.entries()].sort(
    (a, b) => groupSev(a[1]) - groupSev(b[1]) || b[1].length - a[1].length,
  );

  return (
    <ul className="note-list health-groups">
      {groups.map(([key, list]) => {
        const isVirtual = key.startsWith('\u0000');
        const first = list[0];
        const kindsInGroup = [...new Set(list.map((i) => i.kind))];
        const expanded = !!open[key];
        const summary =
          kindsInGroup.length === 1
            ? `${list.length} × ${KIND_LABEL[kindsInGroup[0]] ?? kindsInGroup[0]}`
            : `${list.length} issues (${kindsInGroup
                .map((k) => KIND_LABEL[k] ?? k)
                .join(', ')})`;
        return (
          <li key={key} className={`health-item sev-${first.severity}`}>
            <div className="health-group-head">
              {isVirtual ? (
                <strong>{KIND_LABEL[first.kind] ?? first.kind}</strong>
              ) : (
                <Link to={`/note/${encodeURIComponent(first.relPath ?? "")}`}>
                  {first.relPath}
                </Link>
              )}
              {list.length > 1 && (
                <button
                  className="link-btn"
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpen((o) => ({ ...o, [key]: !o[key] }))
                  }
                >
                  {summary} {expanded ? '▾' : '▸'}
                </button>
              )}
              {list.length === 1 && (
                <span className="muted">{first.description}</span>
              )}
            </div>
            {expanded && list.length > 1 && (
              <ul className="note-list compact health-subitems">
                {list.map((i, idx) => (
                  <li key={idx}>
                    <span className="muted">
                      {KIND_LABEL[i.kind] ?? i.kind} — {i.description}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}