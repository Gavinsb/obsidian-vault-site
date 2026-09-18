import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ChangesBuckets, type ChangeEntry } from '../api';

const BUCKETS: { key: keyof ChangesBuckets; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'older', label: 'Older' },
];

export function ChangedView() {
  const [buckets, setBuckets] = useState<ChangesBuckets | null>(null);

  useEffect(() => {
    api.changes().then((c) => setBuckets(c.buckets)).catch(() => {});
  }, []);

  if (!buckets) return <div className="view loading">Loading changes…</div>;

  return (
    <div className="view">
      <h1>What’s changed?</h1>
      {BUCKETS.map(({ key, label }) => {
        const list = buckets[key];
        if (!list.length) return null;
        return (
          <section key={key} className="card">
            <h3>{label} ({list.length})</h3>
            <ul className="note-list compact">
              {list.map((c: ChangeEntry) => (
                <li key={c.seq}>
                  <span className={`change-badge ${c.type}`}>{c.type}</span>
                  <Link
                    to={`/note/${encodeURIComponent(c.relPath.split(' -> ').pop() ?? c.relPath)}`}
                  >
                    {c.title ?? c.relPath}
                  </Link>
                  <span className="muted">{timeStr(c.atMs)}</span>
                  {c.rating !== undefined && <span className="rating-inline">★{c.rating}</span>}
                  {c.tags.slice(0, 2).map((t) => (
                    <span key={t} className="tag-chip">#{t}</span>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!BUCKETS.some(({ key }) => buckets[key].length) && (
        <p className="muted">No changes recorded yet.</p>
      )}
    </div>
  );
}

function timeStr(ms: number): string {
  return new Date(ms).toLocaleString();
}