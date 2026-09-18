import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type VaultDocSummary } from '../api';
import { RatingStars } from './RatingStars';

export function FavoritesView() {
  const [docs, setDocs] = useState<VaultDocSummary[]>([]);
  useEffect(() => {
    api.docs().then((all) => setDocs(all.filter((d) => (d as any).favorite))).catch(() => {});
  }, []);
  return (
    <div className="view">
      <h1>Favorites</h1>
      {docs.length === 0 ? (
        <p className="muted">No favorites yet. Open a note and tap ☆ Favorite.</p>
      ) : (
        <ul className="note-list">
          {docs.map((d) => (
            <li key={d.relPath}>
              <Link to={`/note/${encodeURIComponent(d.relPath)}`}>{d.title}</Link>
              <RatingStars value={d.rating} size={12} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}