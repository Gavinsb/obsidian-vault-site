import type {
  KnowledgeLens,
  KnowledgeMapComponentDefinition,
  KnowledgeMapItem,
  KnowledgeMapLensDefinition,
  KnowledgeMapResponse,
  KnowledgeScoreComponents,
  KnowledgeScoreDetail,
} from '../shared/types.js';
import type { KnowledgeIndex } from './indexer.js';

const DAY_MS = 86_400_000;
const RECENCY_WINDOW_DAYS = 365;

/**
 * Every score is an additive weighted sum, so an absent/zero rating contributes
 * zero without multiplying away backlink or connectivity importance.
 */
export const KNOWLEDGE_MAP_COMPONENTS: KnowledgeMapComponentDefinition[] = [
  {
    key: 'rating',
    label: 'Rating',
    meaning: 'Frontmatter rating divided by the configured rating scale; missing and zero ratings normalize to 0.',
  },
  {
    key: 'recency',
    label: 'Recency',
    meaning: `Linear freshness from 1 (modified now) to 0 (modified ${RECENCY_WINDOW_DAYS}+ days ago).`,
  },
  {
    key: 'backlinks',
    label: 'Backlinks',
    meaning: 'Incoming-note count normalized against the vault maximum with log1p scaling.',
  },
  {
    key: 'connectivity',
    label: 'Connectivity',
    meaning: 'Unique incoming and resolved outgoing neighbours normalized against the vault maximum with log1p scaling.',
  },
];

export const KNOWLEDGE_MAP_LENSES: KnowledgeMapLensDefinition[] = [
  {
    key: 'important',
    label: 'Important',
    description: 'Balances explicit rating with structural reach and a small freshness signal.',
    terms: [
      { component: 'rating', weight: 0.35, direction: 'high' },
      { component: 'recency', weight: 0.1, direction: 'high' },
      { component: 'backlinks', weight: 0.25, direction: 'high' },
      { component: 'connectivity', weight: 0.3, direction: 'high' },
    ],
  },
  {
    key: 'neglected',
    label: 'Neglected',
    description: 'Surfaces stale or unrated notes while retaining structural importance.',
    terms: [
      { component: 'rating', weight: 0.3, direction: 'low' },
      { component: 'recency', weight: 0.4, direction: 'low' },
      { component: 'backlinks', weight: 0.15, direction: 'high' },
      { component: 'connectivity', weight: 0.15, direction: 'high' },
    ],
  },
  {
    key: 'central',
    label: 'Central',
    description: 'Ranks the notes most embedded in the link structure, independent of rating and age.',
    terms: [
      { component: 'backlinks', weight: 0.55, direction: 'high' },
      { component: 'connectivity', weight: 0.45, direction: 'high' },
    ],
  },
  {
    key: 'emerging',
    label: 'Emerging',
    description: 'Favours recently active notes that are beginning to gain explicit or structural signal.',
    terms: [
      { component: 'rating', weight: 0.15, direction: 'high' },
      { component: 'recency', weight: 0.55, direction: 'high' },
      { component: 'backlinks', weight: 0.1, direction: 'high' },
      { component: 'connectivity', weight: 0.2, direction: 'high' },
    ],
  },
  {
    key: 'suggested-exploration',
    label: 'Suggested exploration',
    description: 'Prioritizes fresh, connected notes with room for more explicit rating and review.',
    terms: [
      { component: 'rating', weight: 0.3, direction: 'low' },
      { component: 'recency', weight: 0.25, direction: 'high' },
      { component: 'backlinks', weight: 0.2, direction: 'high' },
      { component: 'connectivity', weight: 0.25, direction: 'high' },
    ],
  },
];

export interface KnowledgeMapOptions {
  ratingScale: number;
  /** Injected for deterministic scoring and tests; defaults to request time. */
  asOfMs?: number;
}

export function buildKnowledgeMap(
  index: KnowledgeIndex,
  options: KnowledgeMapOptions
): KnowledgeMapResponse {
  const asOfMs = options.asOfMs ?? Date.now();
  const ratingScale = options.ratingScale > 0 ? options.ratingScale : 5;
  const raw = [...index.notes.values()].map((note) => ({
    note,
    backlinkCount: index.backlinksOf(note.meta.relPath).size,
    connectivityCount: index.neighboursOf(note.meta.relPath).size,
  }));
  const maxBacklinks = Math.max(0, ...raw.map((entry) => entry.backlinkCount));
  const maxConnectivity = Math.max(0, ...raw.map((entry) => entry.connectivityCount));

  const items: KnowledgeMapItem[] = raw.map(({ note, backlinkCount, connectivityCount }) => {
    const rating = note.meta.rating;
    const ageDays = Math.max(0, (asOfMs - note.meta.mtimeMs) / DAY_MS);
    const components: KnowledgeScoreComponents = {
      rating: round(clamp((rating ?? 0) / ratingScale)),
      recency: round(clamp(1 - ageDays / RECENCY_WINDOW_DAYS)),
      backlinks: round(logNormalize(backlinkCount, maxBacklinks)),
      connectivity: round(logNormalize(connectivityCount, maxConnectivity)),
    };
    const scores = Object.fromEntries(
      KNOWLEDGE_MAP_LENSES.map((lens) => [lens.key, scoreForLens(components, lens)])
    ) as Record<KnowledgeLens, KnowledgeScoreDetail>;

    return {
      relPath: note.meta.relPath,
      title: note.meta.title,
      folder: note.meta.folder,
      tags: note.meta.tags ?? [],
      rating,
      mtimeMs: note.meta.mtimeMs,
      backlinkCount,
      connectivityCount,
      components,
      scores,
    };
  });

  items.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const rankings = Object.fromEntries(
    KNOWLEDGE_MAP_LENSES.map((lens) => [
      lens.key,
      [...items]
        .sort(
          (a, b) =>
            b.scores[lens.key].value - a.scores[lens.key].value ||
            a.title.localeCompare(b.title) ||
            a.relPath.localeCompare(b.relPath)
        )
        .map((item) => item.relPath),
    ])
  ) as Record<KnowledgeLens, string[]>;

  return {
    asOf: new Date(asOfMs).toISOString(),
    ratingScale,
    components: KNOWLEDGE_MAP_COMPONENTS,
    lenses: KNOWLEDGE_MAP_LENSES,
    items,
    rankings,
  };
}

function scoreForLens(
  components: KnowledgeScoreComponents,
  lens: KnowledgeMapLensDefinition
): KnowledgeScoreDetail {
  const contributions: KnowledgeScoreComponents = {
    rating: 0,
    recency: 0,
    backlinks: 0,
    connectivity: 0,
  };
  for (const term of lens.terms) {
    const normalized = components[term.component];
    const directed = term.direction === 'low' ? 1 - normalized : normalized;
    contributions[term.component] = round(directed * term.weight);
  }
  return {
    value: round(Object.values(contributions).reduce((sum, value) => sum + value, 0)),
    contributions,
  };
}

function logNormalize(value: number, maximum: number): number {
  if (maximum <= 0 || value <= 0) return 0;
  return Math.log1p(value) / Math.log1p(maximum);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
