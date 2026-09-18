/**
 * Reads a document's metadata and content in one go, keeping the provider as
 * the only place that touches the filesystem.
 */
import type { VaultProvider } from './vault-provider.js';
import type { DocMeta } from '../shared/types.js';

export async function readDocumentMetaAndContent(
  provider: VaultProvider,
  relPath: string
): Promise<{ meta: DocMeta; content: string } | null> {
  return provider.readDocument(relPath);
}