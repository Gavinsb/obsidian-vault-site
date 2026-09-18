import { Link } from 'react-router-dom';

export function Breadcrumbs({ folder, current }: { folder: string; current?: string }) {
  if (!folder) return null;
  const parts = folder.split('/').filter(Boolean);
  if (!parts.length) return null;
  let acc = '';
  return (
    <nav className="breadcrumbs">
      {parts.map((p) => {
        acc = acc ? `${acc}/${p}` : p;
        return (
          <span key={acc}>
            <Link to={`/folders?folder=${encodeURIComponent(acc)}`}>{p}</Link>
            <span className="sep">/</span>
          </span>
        );
      })}
      {current && <span className="crumb-current">{current}</span>}
    </nav>
  );
}