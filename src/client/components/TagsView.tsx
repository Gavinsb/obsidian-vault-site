import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type VaultDocSummary } from '../api';

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

  return (
    <div className="view">
      <h1>Tags</h1>
      <div className="tag-cloud">
        {tags.map((t) => (
          <button
            key={t.tag}
            className={`tag-cloud-item${selected === t.tag ? ' selected' : ''}`}
            onClick={() => select(t.tag)}
            style={{ fontSize: Math.max(11, 9 + Math.sqrt(t.count) * 3) }}
            title={t.parent ? `nested under #${t.parent}` : 'top-level tag'}
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