/** Shared domain types used by both the API layer and the UI. */

export interface DocMeta {
  /** Absolute path within the vault, e.g. "02 Concepts/Human Behavior/Dunning-Kruger Effect.md" */
  relPath: string;
  /** Folder relative path (without filename), e.g. "02 Concepts/Human Behavior" */
  folder: string;
  fileName: string;
  /** Basename without extension. */
  baseName: string;
  title: string;
  /** Frontmatter "aliases" (string or string[]). */
  aliases: string[];
  tags: string[];
  /** Flat map of frontmatter keys -> values (raw). */
  frontmatter: Record<string, unknown>;
  rating?: number;
  favorite?: boolean;
  status?: string;
  created?: string;
  updated?: string;
  ctimeMs: number;
  mtimeMs: number;
  size: number;
  wordCount: number;
  /** SHA-256 content hash (secondary conflict guard; HTTP clients use ETag). */
  contentHash: string;
  /** True when frontmatter already existed. */
  hasFrontmatter: boolean;
}

export interface LinkRef {
  target: string;
  alias?: string;
  heading?: string;
  block?: string;
}

export interface OutgoingLink {
  target: string;
  alias?: string;
  heading?: string;
  resolved: boolean;
  /** relPath of the target note when resolved. */
  targetRelPath?: string;
}

export interface Backlink {
  sourceRelPath: string;
  sourceTitle: string;
  context: string;
}

export interface Document {
  meta: DocMeta;
  content: string;
  outgoing: OutgoingLink[];
  backlinks: Backlink[];
}

export interface VaultDocSummary {
  relPath: string;
  title: string;
  folder: string;
  tags: string[];
  rating?: number;
  status?: string;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  aliases: string[];
}

export interface IndexStats {
  noteCount: number;
  linkCount: number;
  backlinkCount: number;
  tagCount: number;
  orphanCount: number;
  brokenLinkCount: number;
  unresolvedWikiLinkCount: number;
  avgRating: number | null;
  ratedCount: number;
  unratedCount: number;
  favoriteCount: number;
  totalWords: number;
}

export interface HealthIssue {
  kind: string;
  severity: "info" | "warn" | "critical";
  description: string;
  relPath?: string;
}

export interface VaultOverview {
  name: string;
  path: string;
  docCount: number;
  folderCount: number;
  stats: IndexStats;
  lastIndexedAt: string | null;
  syncState: string;
  pendingFiles: number;
}

/** Read-only, derived Knowledge Map scoring contract. All normalized values are 0..1. */
export type KnowledgeScoreComponent =
  | "rating"
  | "recency"
  | "backlinks"
  | "connectivity";
export type KnowledgeLens =
  | "important"
  | "neglected"
  | "central"
  | "emerging"
  | "suggested-exploration";

export type KnowledgeScoreComponents = Record<KnowledgeScoreComponent, number>;

export interface KnowledgeMapComponentDefinition {
  key: KnowledgeScoreComponent;
  label: string;
  meaning: string;
}

export interface KnowledgeMapLensTerm {
  component: KnowledgeScoreComponent;
  /** Additive share of the lens score; terms in each lens sum to 1. */
  weight: number;
  /** "high" rewards the normalized value; "low" rewards its inverse (1 - value). */
  direction: "high" | "low";
}

export interface KnowledgeMapLensDefinition {
  key: KnowledgeLens;
  label: string;
  description: string;
  terms: KnowledgeMapLensTerm[];
}

export interface KnowledgeScoreDetail {
  value: number;
  /** Additive contribution after lens direction and weight are applied. */
  contributions: KnowledgeScoreComponents;
}

export interface KnowledgeMapItem {
  relPath: string;
  title: string;
  folder: string;
  tags: string[];
  rating?: number;
  mtimeMs: number;
  backlinkCount: number;
  /** Unique resolved incoming plus outgoing neighbours. */
  connectivityCount: number;
  components: KnowledgeScoreComponents;
  scores: Record<KnowledgeLens, KnowledgeScoreDetail>;
}

export interface KnowledgeMapResponse {
  /** Time used for recency normalization. */
  asOf: string;
  ratingScale: number;
  components: KnowledgeMapComponentDefinition[];
  lenses: KnowledgeMapLensDefinition[];
  items: KnowledgeMapItem[];
  /** Deterministically ordered relPaths for each lens. */
  rankings: Record<KnowledgeLens, string[]>;
}

export type ChangeType = "created" | "modified" | "deleted" | "renamed";

export interface ChangeEvent {
  type: ChangeType;
  relPath: string;
  atMs: number;
  rating?: number;
  tags: string[];
  title?: string;
}

export type Theme = "dark" | "light" | "system";
