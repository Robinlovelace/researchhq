/**
 * Privacy sanitization for public portfolio exports.
 * Guarantees: no `privateNotes` field survives, and any repo link marked
 * `redactUrlInPublic: true` has its URL emptied while keeping the label and
 * `visibility: 'private'`.
 */
import { PortfolioSnapshotSchema, type PortfolioSnapshot } from './schemas.js';

/**
 * Return a deep-cloned, schema-validated snapshot that is safe to publish:
 * `sanitized: true`, every planned paper's `privateNotes` removed, and every
 * repo link with `redactUrlInPublic: true` redacted to an empty URL with
 * `visibility: 'private'`.
 */
export function sanitizePortfolioForPublic(snapshot: PortfolioSnapshot): PortfolioSnapshot {
  const validated = PortfolioSnapshotSchema.parse(snapshot);
  const clone = structuredClone(validated) as PortfolioSnapshot;

  clone.sanitized = true;
  for (const paper of clone.plannedPapers) {
    delete paper.privateNotes;
    for (const link of paper.repoUrls) {
      if (link.redactUrlInPublic === true) {
        link.url = '';
        link.visibility = 'private';
      }
    }
  }

  // Validate the sanitized shape before returning so the guarantee is checked,
  // not assumed.
  return PortfolioSnapshotSchema.parse(clone);
}
