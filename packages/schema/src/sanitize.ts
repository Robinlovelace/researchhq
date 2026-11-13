/**
 * Privacy sanitization for public portfolio exports.
 * Guarantees: no `privateNotes` field survives; every repo link that is
 * `visibility: 'private'` or flagged `redactUrlInPublic: true` is redacted to
 * an empty URL with `visibility: 'private'`; the internal `redactUrlInPublic`
 * flag and the institutional `symplecticId` are stripped everywhere.
 */
import { PortfolioSnapshotSchema, type PortfolioSnapshot } from './schemas.js';

export interface SanitizePortfolioOptions {
  /**
   * Whether to keep confirmed planned-paper collaborators in the public export.
   * Defaults to `false` (private-by-default) so external co-authors on
   * unpublished manuscripts are not exposed publicly unless opted in.
   */
  includeCollaborators?: boolean;
}

/**
 * Return a deep-cloned, schema-validated snapshot that is safe to publish:
 * `sanitized: true`, every planned paper's `privateNotes` removed,
 * `collaborators` cleared by default (or filtered for tentative/TBC entries
 * when `includeCollaborators: true`), repo links without explicit
 * `visibility: 'public'` or flagged `redactUrlInPublic` emptied of URLs,
 * `redactUrlInPublic` flags removed, and `symplecticId` removed.
 */
export function sanitizePortfolioForPublic(
  snapshot: PortfolioSnapshot,
  options: SanitizePortfolioOptions = {},
): PortfolioSnapshot {
  const validated = PortfolioSnapshotSchema.parse(snapshot);
  const clone = structuredClone(validated) as PortfolioSnapshot;

  clone.sanitized = true;
  delete clone.author.symplecticId;
  for (const paper of clone.plannedPapers) {
    delete paper.privateNotes;
    if (options.includeCollaborators) {
      paper.collaborators = paper.collaborators.filter(
        (entry) => !/\b(tbc|unconfirmed|tentative|to\s+be\s+confirmed)\b/i.test(entry),
      );
    } else {
      paper.collaborators = [];
    }
    for (const link of paper.repoUrls) {
      if (link.visibility !== 'public' || link.redactUrlInPublic === true) {
        link.url = '';
        link.visibility = 'private';
      }
      // The redaction flag is an internal instruction: never publish it.
      delete link.redactUrlInPublic;
    }
  }

  // Validate the sanitized shape before returning so the guarantee is checked,
  // not assumed.
  return PortfolioSnapshotSchema.parse(clone);
}
