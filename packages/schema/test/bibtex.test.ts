import { describe, expect, it } from 'vitest';

import {
  PublicationSchema,
  bibtexKeyFor,
  escapeBibtex,
  publicationToBibtex,
  publicationsToBibtex,
  type Publication,
} from '../src/index.js';

function makePublication(overrides: Partial<Publication> = {}): Publication {
  return PublicationSchema.parse({
    id: 'w-1',
    title: 'The Propensity to Cycle Tool: An open source online system',
    year: 2016,
    type: 'article',
    venue: 'Journal of Transport & Health',
    authors: ['Robin Lovelace', 'A. Coauthor'],
    citations: 167,
    topics: ['transport'],
    openScienceStage: 3,
    openScience: { oaStatus: 'gold' },
    ...overrides,
  });
}

describe('escapeBibtex', () => {
  it('escapes \\ { } & % $ _ # ^ ~', () => {
    expect(escapeBibtex('a\\x a_b & c{d}e %f $g #h ^i ~j')).toBe(
      'a\\textbackslash{}x a\\_b \\& c\\{d\\}e \\%f \\$g \\#h \\^{}i \\~{}j',
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeBibtex('Cycling to health: evidence from Leeds')).toBe(
      'Cycling to health: evidence from Leeds',
    );
  });
});

describe('bibtexKeyFor', () => {
  it('builds surnameYEARtitleword keys from the first author surname', () => {
    expect(bibtexKeyFor(makePublication())).toBe('lovelace2016propensity');
  });

  it('handles comma-separated author names', () => {
    expect(bibtexKeyFor(makePublication({ authors: ['Lovelace, Robin'] }))).toBe(
      'lovelace2016propensity',
    );
  });

  it('prefers an explicit bibtexKey', () => {
    expect(bibtexKeyFor(makePublication({ bibtexKey: 'my-custom-key' }))).toBe('my-custom-key');
  });
});

describe('publicationToBibtex', () => {
  it('renders an article entry with escaped fields', () => {
    const entry = publicationToBibtex(makePublication());
    expect(entry).toContain('@article{lovelace2016propensity,');
    expect(entry).toContain('author = {Robin Lovelace and A. Coauthor}');
    expect(entry).toContain('journal = {Journal of Transport \\& Health}');
    expect(entry).toContain('year = {2016}');
    expect(entry).not.toContain('\n\n');
  });

  it('renders books with publisher, chapters with booktitle, reports with institution, and misc with howpublished', () => {
    const book = publicationToBibtex(makePublication({ type: 'book', venue: 'CRC Press' }));
    expect(book).toContain('@book{');
    expect(book).toContain('publisher = {CRC Press}');
    expect(book).not.toContain('journal = ');

    const chapter = publicationToBibtex(
      makePublication({ type: 'book-chapter', venue: 'Handbook of Transport' }),
    );
    expect(chapter).toContain('@incollection{');
    expect(chapter).toContain('booktitle = {Handbook of Transport}');
    expect(chapter).not.toContain('journal = ');

    const report = publicationToBibtex(
      makePublication({ type: 'report', venue: 'Department for Transport' }),
    );
    expect(report).toContain('@techreport{');
    expect(report).toContain('institution = {Department for Transport}');
  });

  it('omits citation notes by default so reference lists stay clean', () => {
    const clean = publicationToBibtex(makePublication({ citations: 167 }));
    expect(clean).not.toContain('citations (OpenAlex)');
    const withNote = publicationToBibtex(makePublication({ citations: 167 }), {
      includeCitationNote: true,
    });
    expect(withNote).toContain('note = {167 citations (OpenAlex)}');
  });

  it('escapes special characters inside titles and abstracts', () => {
    const entry = publicationToBibtex(
      makePublication({ abstract: 'R&D costs 50% more, try it_yourself' }),
    );
    expect(entry).toContain('R\\&D costs 50\\% more, try it\\_yourself');
  });
});

describe('publicationsToBibtex', () => {
  it('joins multiple entries with blank lines', () => {
    const text = publicationsToBibtex([
      makePublication({ id: 'w-1' }),
      makePublication({ id: 'w-2', title: 'Another paper on bikes', year: 2020 }),
    ]);
    expect(text).toContain('@article{lovelace2016propensity,');
    expect(text).toContain('@article{lovelace2020another,');
    expect(text.split('\n\n').length).toBe(2);
  });

  it('disambiguates colliding cite keys with a/b/c suffixes', () => {
    const text = publicationsToBibtex([
      makePublication({ id: 'w-1', title: 'Book review: Cycling futures', year: 2014 }),
      makePublication({ id: 'w-2', title: 'Book review: Urban transport', year: 2014 }),
      makePublication({ id: 'w-3', title: 'Book review: Spatial models', year: 2014 }),
    ]);
    expect(text).toContain('@article{lovelace2014booka,');
    expect(text).toContain('@article{lovelace2014bookb,');
    expect(text).toContain('@article{lovelace2014bookc,');
  });
});
