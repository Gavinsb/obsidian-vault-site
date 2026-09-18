import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type VaultDocSummary } from '../api';
import { RatingStars } from './RatingStars';

export function RecentView() {
  const [docs, setDocs] = useState<VaultDocSummary[]>([]);
  useEffect(() => {
    api.recent(200).then(setDocs).catch(() => {});
  }, []);
  return (
    <div className="view">
      <h1>Recently modified</h1>
      <ul className="note-list">
        {docs.map((d) => (
          <li key={d.relPath}>
            <Link to={`/note/${encodeURIComponent(d.relPath)}`}>{d.title}</Link>
            <span className="folder-path">{d.folder}</span>
            <span className="muted">{smartTime(d.mtimeMs)}</span>
            <RatingStars value={d.rating} size={12} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function smartTime(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16);
}