import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type VaultDocSummary } from '../api';

interface TagInfo {
  tag: string;
  count: number;
  parent?: string;
}

/** Vibrant palette for the word cloud. */
const PALETTE: Array<[number, number, number]> = [
  [79, 140, 255],   // blue
  [55, 200, 119],   // green
  [224, 166, 58],   // amber
  [186, 104, 255],  // purple
  [255, 122, 159],  // pink
  [56, 199, 199],   // teal
  [255, 149, 82],   // orange
  [122, 190, 255],  // light blue
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface Placed {
  tag: TagInfo;
  x: number; // 0..100 (%)
  y: number; // 0..100 (%)
  size: number;
  color: [number, number, number];
  alpha: number;
}

/**
 * Deterministic "word cloud": chips scattered at pseudo-random positions,
 * sized by frequency, coloured from a multi-hue palette.
 */
export function TagsView() {
  const [tags, setTags] = useState<TagInfo[]>([]);
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

  const placed: Placed[] = useMemo(() => {
    return tags
      .map((tag) => {
        const ratio = tag.count / maxCount;
        const h = hash(tag.tag);
        const size = 13 + ratio * 22; // 13–35px
        const x = 4 + ((h * 7 + 3) % 920) / 10; // 4–96%
        const y = 4 + ((h * 13 + 5) % 820) / 10; // 4–86%
        const color = PALETTE[h % PALETTE.length];
        const alpha = 0.55 + ratio * 0.45;
        return { tag, x, y, size, color, alpha };
      })
      .sort((a, b) => b.size - a.size);
  }, [tags, maxCount]);

  return (
    <div className="view">
      <h1>Tags</h1>
      <p className="muted">Bigger = more notes. Tap a tag to see its notes.</p>
      <div className="word-cloud">
        {placed.map(({ tag, x, y, size, color, alpha }) => {
          const [r, g, b] = color;
          return (
            <button
              key={tag.tag}
              className={`word-cloud-chip${selected === tag.tag ? ' selected' : ''}`}
              onClick={() => select(tag.tag)}
              title={`#${tag.tag} — ${tag.count} note${tag.count === 1 ? '' : 's'}${
                tag.parent ? ` · nested under #${tag.parent}` : ''
              }`}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                fontSize: size,
                color: `rgba(${r}, ${g}, ${b}, ${alpha})`,
                borderColor: `rgba(${r}, ${g}, ${b}, ${alpha * 0.6})`,
              }}
            >
              #{tag.tag}
            </button>
          );
        })}
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