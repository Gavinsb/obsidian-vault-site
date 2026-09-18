import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type SearchHit } from '../api';
import { RatingStars } from './RatingStars';

export function Search() {
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [tagFilter, setTagFilter] = useState(params.get('tag') ?? '');
  const [ratingMin, setRatingMin] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (params.get('tag')) {
      setTagFilter(params.get('tag')!);
      run(params.get('tag')!, { tag: params.get('tag')! });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (query: string, filters: Record<string, unknown> = {}) => {
    setSearched(true);
    const res = await api.search(query, {
      tag: tagFilter || undefined,
      ratingMin: ratingMin ? Number(ratingMin) : undefined,
      ...filters,
    });
    setResults(res.results);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() && !tagFilter) return;
    run(q.trim(), { tag: tagFilter || undefined, ratingMin: ratingMin ? Number(ratingMin) : undefined });
  };

  return (
    <div className="view">
      <h1>Search</h1>
      <form className="search-bar" onSubmit={onSubmit}>
        <input
          placeholder="Search titles, content, tags, aliases…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <input
          placeholder="tag filter (#tag)"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="narrow-input"
        />
        <select value={ratingMin} onChange={(e) => setRatingMin(e.target.value)} className="narrow-input">
          <option value="">Any rating</option>
          <option value="5">5★</option>
          <option value="4">4★+</option>
          <option value="3">3★+</option>
          <option value="2">2★+</option>
          <option value="1">1★+</option>
        </select>
        <button className="primary" type="submit">
          Search
        </button>
      </form>

      {!searched && <p className="muted">Type a query to search the whole vault.</p>}
      {searched && results.length === 0 && <p className="muted">No results.</p>}
      <ul className="search-results">
        {results.map((r) => (
          <li key={r.relPath} className="search-item">
            <Link to={`/note/${encodeURIComponent(r.relPath)}`}>
              <div className="search-title">
                {r.title}
                <span className="matched-field">{r.matchedField}</span>
              </div>
            </Link>
            <div className="search-snippet">{r.snippet}</div>
            <div className="search-meta">
              <span className="folder-path">{r.folder || '(root)'}</span>
              <RatingStars value={r.rating} size={12} />
              {r.tags.slice(0, 4).map((t) => (
                <span key={t} className="tag-chip">#{t}</span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}