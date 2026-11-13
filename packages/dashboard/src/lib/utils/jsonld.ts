/**
 * Schema.org JSON-LD generation for the ResearchHQ portfolio.
 *
 * Emits a single <script type="application/ld+json"> tag whose @graph contains
 * the author as a Person node (#author) plus the top-cited works typed as
 * ScholarlyArticle, Book, or SoftwareSourceCode. Opening angle brackets are
 * escaped as \u003c so a title containing "</script>" can never break out of
 * the JSON-LD block.
 */
import type { PortfolioSnapshot, Publication } from '@researchhq/schema';
import { safeHref } from './url';

function workNodeType(type: Publication['type']): string {
  if (type === 'book' || type === 'book-chapter') return 'Book';
  if (type === 'software') return 'SoftwareSourceCode';
  return 'ScholarlyArticle';
}

function buildAuthorNode(snapshot: PortfolioSnapshot): Record<string, unknown> {
  const author = snapshot.author;
  const sameAs = [
    author.orcid ? `https://orcid.org/${author.orcid}` : null,
    author.website ?? null,
    author.github ?? null,
    author.bluesky ?? null,
    author.openalexId ? `https://openalex.org/${author.openalexId}` : null,
    author.scholarId
      ? `https://scholar.google.com/citations?user=${author.scholarId}`
      : null
  ].filter((url): url is string => typeof url === 'string' && url.length > 0);

  return {
    '@type': 'Person',
    '@id': '#author',
    name: author.name,
    jobTitle: author.role,
    affiliation: {
      '@type': 'Organization',
      name: author.affiliation
    },
    ...(sameAs.length > 0 ? { sameAs } : {})
  };
}

function buildWorkNode(publication: Publication): Record<string, unknown> {
  const oaStatus = publication.openScience.oaStatus;
  const isOa =
    oaStatus === 'gold' || oaStatus === 'diamond' || oaStatus === 'hybrid' || oaStatus === 'green';

  const safeUrl = safeHref(publication.url);
  return {
    '@type': workNodeType(publication.type),
    '@id': `#work-${publication.id}`,
    name: publication.title,
    datePublished: String(publication.year),
    author: publication.authors.map((name) => ({ '@type': 'Person', name })),
    ...(publication.doi
      ? { identifier: `https://doi.org/${publication.doi}` }
      : {}),
    ...(safeUrl ? { url: safeUrl } : {}),
    ...(isOa ? { isAccessibleForFree: true } : {}),
    // Periodical isPartOf only makes sense for journal articles: books use
    // the venue as a publisher, so omit it for book-type works.
    ...(publication.venue && publication.type !== 'book'
      ? { isPartOf: { '@type': 'Periodical', name: publication.venue } }
      : {})
  };
}

/**
 * Build the ready-to-render JSON-LD script tag for a portfolio snapshot:
 * the author Person node followed by the 10 highest-cited works.
 */
export function buildPortfolioJsonLdTag(snapshot: PortfolioSnapshot): string {
  const topWorks = [...snapshot.publications]
    .sort((a, b) => b.citations - a.citations || b.year - a.year)
    .slice(0, 10)
    .map(buildWorkNode);

  const doc = {
    '@context': 'https://schema.org',
    '@graph': [buildAuthorNode(snapshot), ...topWorks]
  };

  const json = JSON.stringify(doc).replace(/</g, '\\u003c');
  return (
    '<' +
    'script type="application/ld+json">' +
    json +
    '</' +
    'script>'
  );
}
