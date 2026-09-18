import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type KnowledgeLens,
  type KnowledgeMapItem,
  type KnowledgeMapResponse,
} from '../api';

const COMPONENT_ORDER = ['rating', 'recency', 'backlinks', 'connectivity'] as const;
type RatingFilter = 'all' | 'rated' | 'unrated';

export function KnowledgeMapView() {
  const [data, setData] = useState<KnowledgeMapResponse | null>(null);
  const [lens, setLens] = useState<KnowledgeLens>('important');
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .knowledgeMap()
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const folders = useMemo(
    () => [...new Set(data?.items.map((item) => item.folder) ?? [])].sort(),
    [data]
  );
  const tags = useMemo(
    () => [...new Set(data?.items.flatMap((item) => item.tags) ?? [])].sort(),
    [data]
  );
  const ranked = useMemo(() => {
    if (!data) return [];
    const byPath = new Map(data.items.map((item) => [item.relPath, item]));
    return data.rankings[lens]
      .map((relPath) => byPath.get(relPath))
      .filter((item): item is KnowledgeMapItem => Boolean(item))
      .filter((item) => {
        const needle = query.trim().toLowerCase();
        if (needle && !`${item.title} ${item.relPath} ${item.tags.join(' ')}`.toLowerCase().includes(needle)) {
          return false;
        }
        if (folder && item.folder !== folder) return false;
        if (tag && !item.tags.includes(tag)) return false;
        if (ratingFilter === 'rated' && item.rating === undefined) return false;
        if (ratingFilter === 'unrated' && item.rating !== undefined) return false;
        return true;
      });
  }, [data, lens, query, folder, tag, ratingFilter]);

  if (error) {
    return (
      <div className="view">
        <h1>Knowledge Map</h1>
        <div className="card error-card">Could not load scores: {error}</div>
      </div>
    );
  }
  if (!data) return <div className="view loading">Building Knowledge Map…</div>;

  const activeLens = data.lenses.find((definition) => definition.key === lens)!;
  const componentLabels = Object.fromEntries(
    data.components.map((component) => [component.key, component.label])
  ) as Record<(typeof COMPONENT_ORDER)[number], string>;

  return (
    <div className="view knowledge-map-view">
      <div className="view-header">
        <div>
          <h1>Knowledge Map</h1>
          <p className="muted">
            Read-only rankings derived from ratings, modification time, backlinks, and resolved
            connectivity. Scores never modify vault files.
          </p>
        </div>
      </div>

      <div className="knowledge-lenses" role="tablist" aria-label="Knowledge Map lens">
        {data.lenses.map((definition) => (
          <button
            key={definition.key}
            role="tab"
            aria-selected={lens === definition.key}
            className={`knowledge-lens${lens === definition.key ? ' active' : ''}`}
            onClick={() => {
              setLens(definition.key);
              setExpanded(null);
            }}
          >
            {definition.label}
          </button>
        ))}
      </div>

      <section className="card knowledge-explainer">
        <h3>{activeLens.label}</h3>
        <p>{activeLens.description}</p>
        <div className="knowledge-formula" aria-label={`${activeLens.label} weights`}>
          {activeLens.terms.map((term) => (
            <span key={term.component} className="formula-term">
              {Math.round(term.weight * 100)}% {term.direction === 'low' ? 'low ' : ''}
              {componentLabels[term.component].toLowerCase()}
            </span>
          ))}
        </div>
        <details>
          <summary>How components are normalized</summary>
          <dl className="knowledge-definitions">
            {data.components.map((component) => (
              <div key={component.key}>
                <dt>{component.label}</dt>
                <dd>{component.meaning}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            Lens scores are additive weighted sums. A missing or zero rating contributes zero to
            high-rating terms, but cannot erase backlink or connectivity contributions.
          </p>
        </details>
      </section>

      <div className="knowledge-filters" aria-label="Knowledge Map filters">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter title, path, or tag…"
          aria-label="Filter notes"
        />
        <select value={folder} onChange={(event) => setFolder(event.target.value)} aria-label="Folder">
          <option value="">All folders</option>
          {folders.map((value) => (
            <option key={value} value={value}>
              {value || '(root)'}
            </option>
          ))}
        </select>
        <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="Tag">
          <option value="">All tags</option>
          {tags.map((value) => (
            <option key={value} value={value}>
              #{value}
            </option>
          ))}
        </select>
        <select
          value={ratingFilter}
          onChange={(event) => setRatingFilter(event.target.value as RatingFilter)}
          aria-label="Rating status"
        >
          <option value="all">Rated + unrated</option>
          <option value="rated">Rated only</option>
          <option value="unrated">Unrated only</option>
        </select>
      </div>

      <div className="knowledge-result-count">
        {ranked.length} of {data.items.length} notes · scored at{' '}
        {new Date(data.asOf).toLocaleString()}
      </div>

      <ol className="knowledge-ranking">
        {ranked.map((item) => {
          const detail = item.scores[lens];
          const isExpanded = expanded === item.relPath;
          return (
            <li key={item.relPath} className="knowledge-card">
              <div className="knowledge-card-main">
                <div className="knowledge-rank" aria-label="Rank">
                  {data.rankings[lens].indexOf(item.relPath) + 1}
                </div>
                <div className="knowledge-note">
                  <Link to={`/note/${encodeURIComponent(item.relPath)}`}>{item.title}</Link>
                  <div className="knowledge-note-meta">
                    <span>{item.folder || '(root)'}</span>
                    <span>{item.backlinkCount} backlinks</span>
                    <span>{item.connectivityCount} connections</span>
                    <span>{item.rating === undefined ? 'unrated' : `${item.rating}/${data.ratingScale} rating`}</span>
                  </div>
                  {item.tags.length > 0 && (
                    <div className="tag-list">
                      {item.tags.slice(0, 5).map((value) => (
                        <span key={value} className="tag-chip">
                          #{value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="knowledge-score">
                  <strong>{Math.round(detail.value * 100)}</strong>
                  <span>score</span>
                </div>
                <button
                  className="knowledge-breakdown-toggle"
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? null : item.relPath)}
                >
                  {isExpanded ? 'Hide breakdown' : 'Explain score'}
                </button>
              </div>
              {isExpanded && (
                <div className="knowledge-breakdown">
                  {COMPONENT_ORDER.map((component) => {
                    const definition = data.components.find((entry) => entry.key === component)!;
                    const term = activeLens.terms.find((entry) => entry.component === component);
                    return (
                      <div key={component} className="breakdown-row">
                        <div>
                          <strong>{definition.label}</strong>
                          <span className="muted">
                            normalized {percent(item.components[component])}
                            {term
                              ? ` · ${Math.round(term.weight * 100)}% ${term.direction === 'low' ? 'inverse' : 'weight'}`
                              : ' · not used by this lens'}
                          </span>
                        </div>
                        <div className="breakdown-bar" aria-hidden="true">
                          <span style={{ width: percent(item.components[component]) }} />
                        </div>
                        <strong>+{percent(detail.contributions[component])}</strong>
                      </div>
                    );
                  })}
                  <p className="muted breakdown-total">
                    Contributions sum to {detail.value.toFixed(4)}. Raw signals: rating{' '}
                    {item.rating ?? 'missing'}, {item.backlinkCount} backlinks,{' '}
                    {item.connectivityCount} unique neighbours, modified{' '}
                    {new Date(item.mtimeMs).toLocaleDateString()}.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {ranked.length === 0 && <p className="muted">No notes match these filters.</p>}
    </div>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
