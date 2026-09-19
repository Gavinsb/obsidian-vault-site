import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type VaultDocSummary } from '../api';

const ACCENT = [79, 140, 255]; // #4f8cff

/** Scale chip size + colour intensity by frequency (0..1 ratio). */
function tagStyle(ratio: number): React.CSSProperties {
  const size = 12 + ratio * 12; // 12–24px
  const padX = 8 + ratio * 10;
  const padY = 3 + ratio * 6;
  const [r, g, b] = ACCENT;
  const bgAlpha = 0.12 + ratio * 0.7;
  const strong = ratio > 0.55;
  return {
    fontSize: size,
    padding: `${padY}px ${padX}px`,
    background: `rgba(${r}, ${g}, ${b}, ${bgAlpha})`,
    borderColor: `rgba(${r}, ${g}, ${b}, ${0.35 + ratio * 0.65})`,
    color: strong ? '#ffffff' : undefined,
    fontWeight: strong ? 600 : 500,
  };
}

export function TagsView() {
  const [tags, setTags] = useState<{ tag: string; count: number; parent?: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [docs, setDocs] = useState<VaultDocSummary[]>([]);

  useEffect(() => {
    api.tags().then(setTags).catch(() => {});
  }, []);

  const select = async (t: string) => {
    setSelected(t);
    setDocs(await api.tagDocs(t));
  };

  const maxCount = tags.length ? Math.max(...tags.map((t) => t.count)) : 1;

  return (
    <div className="view">
      <h1>Tags</h1>
      <p className="muted">Bigger, brighter chips = more notes with that tag.</p>
      <div className="tag-cloud">
        {tags.map((t) => (
          <button
            key={t.tag}
            className={`tag-cloud-item${selected === t.tag ? ' selected' : ''}`}
            onClick={() => select(t.tag)}
            style={tagStyle(t.count / maxCount)}
            title={`#${t.tag} — ${t.count} note${t.count === 1 ? '' : 's'}${
              t.parent ? ` · nested under #${t.parent}` : ''
            }`}
          >
            #{t.tag} <span className="tag-count">{t.count}</span>
          </button>
        ))}
        {tags.length === 0 && <p className="muted">No tags found.</p>}
      </div>

      {selected && (
        <section className="card">
          <h3>Notes tagged #{selected}</h3>
          <ul className="note-list">
            {docs.map((d) => (
              <li key={d.relPath}>
                <Link to={`/note/${encodeURIComponent(d.relPath)}`}>{d.title}</Link>
                <span className="folder-path">{d.folder}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}