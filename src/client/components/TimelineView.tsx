import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { RatingStars } from './RatingStars';

export function TimelineView() {
  const [entries, setEntries] = useState<
    { date: string; title: string; relPath: string; type: string; tags: string[]; rating?: number }[]
  >([]);
  const [tagFilter, setTagFilter] = useState('');

  useEffect(() => {
    api.timeline().then(setEntries).catch(() => {});
  }, []);

  const shown = tagFilter ? entries.filter((e) => e.tags.includes(tagFilter)) : entries;
  const allTags = [...new Set(entries.flatMap((e) => e.tags))].sort();

  // Group by date.
  const groups: { date: string; items: typeof entries }[] = [];
  for (const e of shown) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }

  return (
    <div className="view">
      <h1>Activity timeline</h1>
      <div className="chip-row">
        <button
          className={`chip${tagFilter === '' ? ' on' : ''}`}
          onClick={() => setTagFilter('')}
        >
          All
        </button>
        {allTags.map((t) => (
          <button
            key={t}
            className={`chip${tagFilter === t ? ' on' : ''}`}
            onClick={() => setTagFilter(t)}
          >
            #{t}
          </button>
        ))}
      </div>

      {groups.map((g) => (
        <section key={g.date} className="timeline-group">
          <h3 className="tl-heading">{g.date}</h3>
          <ul className="note-list">
            {g.items.map((e, i) => (
              <li key={i}>
                <Link to={`/note/${encodeURIComponent(e.relPath)}`}>{e.title}</Link>
                <span className={`change-badge ${e.type}`}>{e.type}</span>
                {e.rating !== undefined && <RatingStars value={e.rating} size={12} />}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {groups.length === 0 && <p className="muted">No activity.</p>}
    </div>
  );
}