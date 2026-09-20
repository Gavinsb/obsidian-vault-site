import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type VaultDocSummary } from "../api";
import {
  sortTags,
  stableTagHue,
  type TagInfo,
  type TagSort,
} from "../../shared/editor-utils";
export function TagsView() {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [docs, setDocs] = useState<VaultDocSummary[]>([]);
  const [sort, setSort] = useState<TagSort>("count");
  useEffect(() => {
    api
      .tags()
      .then(setTags)
      .catch(() => {});
  }, []);
  const ordered = useMemo(() => sortTags(tags, sort), [tags, sort]);
  const max = Math.max(1, ...tags.map((t) => t.count)),
    min = Math.min(max, ...tags.map((t) => t.count));
  const select = async (t: string) => {
    setSelected(t);
    setDocs(await api.tagDocs(t));
  };
  return (
    <div className="view tags-view">
      <h1>Tags</h1>
      <p className="muted">Bigger = more notes. Select a tag in either view.</p>
      {tags.length === 0 ? (
        <div className="card">No tags found.</div>
      ) : (
        <>
          <div className="tags-layout">
            <div className="tag-visual-cloud" aria-label="Tag cloud">
              {sortTags(tags, "count").map((t, i) => {
                const ratio = max === min ? 0.5 : (t.count - min) / (max - min);
                return (
                  <button
                    key={t.tag}
                    className={selected === t.tag ? "selected" : ""}
                    title={`#${t.tag} — ${t.count} note${t.count === 1 ? "" : "s"}`}
                    onClick={() => void select(t.tag)}
                    style={{
                      fontSize: `clamp(0.9rem, ${1 + ratio * 1.8}rem, 2.8rem)`,
                      color: `hsl(${stableTagHue(t.tag)} 70% 62%)`,
                      fontWeight: ratio > 0.55 ? 750 : 600,
                      transform:
                        i % 7 === 4
                          ? "rotate(-4deg)"
                          : i % 9 === 3
                            ? "rotate(3deg)"
                            : "none",
                    }}
                  >
                    #{t.tag}
                  </button>
                );
              })}
            </div>
            <aside className="tag-directory card">
              <div className="tag-directory-head">
                <h3>Directory</h3>
                <div role="group" aria-label="Sort tags">
                  <button
                    className={sort === "count" ? "active" : ""}
                    onClick={() => setSort("count")}
                  >
                    Count
                  </button>
                  <button
                    className={sort === "alpha" ? "active" : ""}
                    onClick={() => setSort("alpha")}
                  >
                    A–Z
                  </button>
                </div>
              </div>
              <div className="tag-directory-list">
                {ordered.map((t) => (
                  <button
                    key={t.tag}
                    className={selected === t.tag ? "selected" : ""}
                    onClick={() => void select(t.tag)}
                  >
                    <span>#{t.tag}</span>
                    <strong>{t.count}</strong>
                  </button>
                ))}
              </div>
            </aside>
          </div>
          {selected && (
            <section className="card selected-tag-notes">
              <h3>Notes tagged #{selected}</h3>
              <ul className="note-list">
                {docs.map((d) => (
                  <li key={d.relPath}>
                    <Link to={`/note/${encodeURIComponent(d.relPath)}`}>
                      {d.title}
                    </Link>
                    <span className="folder-path">{d.folder}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
