import { useState } from 'react';

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
  return (
    <div
      className={`stars${onChange ? ' editable' : ''}`}
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
            onMouseEnter={() => onChange && setHover(n)}
            onClick={() => onChange?.(n)}
          >
            ★
          </span>
        );
      })}
      {!value && <span className="star-label">unrated</span>}
    </div>
  );
}