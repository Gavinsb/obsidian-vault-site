import { useState, type KeyboardEvent } from 'react';

export function RatingStars({
  value,
  scale = 5,
  onChange,
  size = 20,
}: {
  value?: number;
  scale?: number;
  onChange?: (v: number) => void;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const editable = !!onChange;

  function onKeyDown(e: KeyboardEvent, n: number) {
    if (!editable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onChange?.(n);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange?.(Math.min(scale, (value ?? 0) + 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange?.(Math.max(1, (value ?? 0) - 1));
    }
  }

  return (
    <div
      className={`stars${editable ? ' editable' : ''}`}
      role={editable ? 'group' : 'img'}
      onMouseLeave={() => setHover(null)}
      aria-label={`Rating: ${value ?? 'unrated'}/${scale}`}
    >
      {Array.from({ length: scale }, (_, i) => {
        const n = i + 1;
        const filled = shown >= n;
        return (
          <span
            key={n}
            className={`star${filled ? ' filled' : ''}`}
            style={{ width: size, height: size, fontSize: size }}
            onMouseEnter={() => editable && setHover(n)}
            onClick={() => onChange?.(n)}
            role={editable ? 'button' : undefined}
            aria-label={editable ? `Rate ${n} of ${scale}` : undefined}
            tabIndex={editable ? 0 : undefined}
            onKeyDown={(e) => onKeyDown(e, n)}
          >
            ★
          </span>
        );
      })}
      {!value && <span className="star-label">unrated</span>}
    </div>
  );
}