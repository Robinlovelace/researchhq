import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage for the ResearchHQ dashboard static production build.
 *
 * Every assertion is grounded in the app's actual markup and in the seeded
 * snapshot data (packages/dashboard/static/data/portfolio.json):
 *   - OpenAlex citations 2,531 vs Google Scholar 4,200
 *   - Journal of Transport Geography: JIF 6.80 (2025 JCR), Q1, hybrid provenance
 *   - 2027 planned: 6 submissions / 5 target publications
 *   - 8 seeded planned papers, csis private repos exported redacted
 */

const TAB_LABELS = [
  'Overview & Open Science',
  'Time Series (Past & Future)',
  'Journals & Impact Metrics',
  'Publications Explorer',
  'Future Papers Pipeline'
];

const PLANNED_PAPER_TITLES = [
  "Methods for prioritising 'bike buses' for safe and sociable cycling to school",
  'Critical Safety Issues v2: national exposure-calibrated cycling level of service and safety appraisal for England',
  'Benchmarking street-level cycle network quality metrics against observed cycling flows',
  'RailActive: strategic appraisal of national rail-to-active-travel corridors along the HS2 legacy route',
  'The five stages of open and reproducible science for policy-relevant research',
  'Iterative induced-demand and streetspace-feasible cycle network growth',
  'Volume-calibrated rat-run and LTN spillover screening with compressed traffic assignment',
  'Exposure-calibrated multi-modal junction and link crash risk modelling'
];

const THEME_STORAGE_KEY = 'researchhq-color-scheme';

/** Citations KPI big number in the first overview card. */
function citationsKpi(page: Page) {
  return page.locator(
    'xpath=//span[normalize-space()="Citations"]/ancestor::div[contains(@class,"rounded-xl")][1]//span[contains(@class,"text-3xl")]'
  );
}

/** Shared polite live region used for sorting / filter announcements. */
function politeAnnouncer(page: Page) {
  return page.locator('div[role="status"]');
}

test('loads with zero console errors, a skip link, the author h1 and all five tab buttons', async ({
  page
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: Error[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // Browsers always request /favicon.ico which is not part of the static
    // build output; that resource 404 is environment noise, not an app error.
    if (/favicon/i.test(message.text())) return;
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto('/');

  await expect(page.locator('a.skip-link')).toHaveText('Skip to main content');

  const h1 = page.locator('h1#dashboard-title');
  await expect(h1).toContainText('Robin Lovelace');

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  for (const label of TAB_LABELS) {
    await expect(page.getByRole('tab', { name: new RegExp(label.replace(/[&()]/g, '\\$&')) })).toBeVisible();
  }

  await expect(page.locator('#panel-overview')).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('citation source switcher reactively updates KPI and per-publication citation numbers', async ({
  page
}) => {
  await page.goto('/');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();

  const selector = page.locator('#citation-source-select');

  // Google Scholar preferred: author-level total and PCT work citations
  await selector.selectOption('scholar');
  await expect(citationsKpi(page)).toHaveText('4,200');
  await expect(
    page.locator('li').filter({ hasText: 'Propensity to Cycle Tool' }).locator('span.tabular-nums')
  ).toHaveText('167');

  // OpenAlex only
  await selector.selectOption('openalex');
  await expect(citationsKpi(page)).toHaveText('2,531');
  await expect(
    page.locator('li').filter({ hasText: 'Propensity to Cycle Tool' }).locator('span.tabular-nums')
  ).toHaveText('155');

  // The KPI helper text always names both sources
  await expect(page.getByText(/OpenAlex: 2,531 · Scholar: 4,200\+/)).toBeVisible();
});

test('Stage 5 scorecard card switches to the Publications tab filtered to Stage 5 outputs', async ({
  page
}) => {
  await page.goto('/');

  const stage5Card = page.locator('#panel-overview ol button').filter({ hasText: 'Stage 5' });
  await expect(stage5Card).toContainText('Deployed Interactive Tool');
  await stage5Card.click();

  await expect(page.locator('#panel-publications')).toBeVisible();
  await expect(page.locator('#pub-stage-select')).toHaveValue('5');
  await expect(page.getByText('Stage: 5', { exact: true })).toBeVisible();

  const tbody = page.locator('table tbody');
  await expect(tbody.locator('tr')).toHaveCount(4);
  await expect(tbody).toContainText('The Propensity to Cycle Tool');
  await expect(tbody).toContainText('CRUSE');
  await expect(tbody).toContainText('Corenet');
  await expect(tbody).toContainText('spanishoddata');
});

test('theme toggle updates meta color-scheme and persists the choice across reloads', async ({
  page
}) => {
  await page.goto('/');

  const meta = page.locator('meta[name="color-scheme"]');

  await page.getByRole('button', { name: /^Dark$/ }).click();
  await expect(meta).toHaveAttribute('content', 'dark');
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), THEME_STORAGE_KEY))
    .toBe('dark');

  // The inline script in app.html re-applies the stored choice after reload
  await page.reload();
  await expect(meta).toHaveAttribute('content', 'dark');

  await page.getByRole('button', { name: /^Light$/ }).click();
  await expect(meta).toHaveAttribute('content', 'light');
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), THEME_STORAGE_KEY))
    .toBe('light');

  await page.getByRole('button', { name: /^Auto$/ }).click();
  await expect(meta).toHaveAttribute('content', 'light dark');
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), THEME_STORAGE_KEY))
    .toBe(null);
});

test('journals table shows JTG provenance metrics, sortable headers, announcements and filter navigation', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Journals & Impact Metrics/ }).click();

  const jtgRow = page
    .locator('table tbody tr')
    .filter({ hasText: 'Journal of Transport Geography' });
  await expect(jtgRow).toBeVisible();
  await expect(jtgRow).toContainText('6.80');
  await expect(jtgRow).toContainText('2025 JCR');
  await expect(jtgRow).toContainText('Q1');
  await expect(jtgRow).toContainText('hybrid');

  const jifHeader = page.locator('th').filter({ hasText: 'Impact Factor (JIF)' });
  await page.getByRole('button', { name: 'Impact Factor (JIF)' }).click();
  await expect(jifHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(politeAnnouncer(page)).toContainText('Sorted by Impact Factor (JIF), ascending');

  await page.getByRole('button', { name: 'Impact Factor (JIF)' }).click();
  await expect(jifHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(politeAnnouncer(page)).toContainText('Sorted by Impact Factor (JIF), descending');

  // Row action navigates to the Publications tab pre-filtered to JTG
  await jtgRow.getByRole('button', { name: 'Filter papers' }).click();
  await expect(page.locator('#panel-publications')).toBeVisible();
  await expect(page.getByText('Journal: Journal of Transport Geography', { exact: true })).toBeVisible();
  await expect(page.locator('p').filter({ hasText: /Showing/ })).toContainText('8 of 8 publications');
});

test('time series renders historical bars plus 2026-2028 planned markers and an accessible table', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Time Series \(Past & Future\)/ }).click();

  const chart = page.locator('svg[aria-labelledby="ts-svg-title ts-svg-desc"]');
  const bars = chart.locator('g[role="button"]');
  await expect(bars).toHaveCount(18);

  // Historical bars carry aria labels with published counts
  await expect(bars.first()).toHaveAttribute('aria-label', /2011: \d+ published/);

  // Future planned markers for 2026, 2027 and 2028. The 'plan' tag renders
  // only for years flagged isFuture in the snapshot (2027, 2028); 2026 is the
  // current year and shows its in-flight planned submissions bar instead.
  for (const year of ['2026', '2027', '2028']) {
    await expect(chart.getByText(year, { exact: true })).toBeVisible();
  }
  await expect(chart.getByText('plan', { exact: true })).toHaveCount(2);

  // Accessible data table companion
  await page.getByRole('button', { name: 'Show accessible table' }).click();
  const row2027 = page
    .locator('table tbody tr')
    .filter({ has: page.locator('td').filter({ hasText: /(^|\s)2027/ }).first() });
  await expect(row2027).toBeVisible();
  await expect(row2027).toContainText('(Planned)');
  // Seeded 2027 plan: 6 submissions and 5 target publications, each in its own
  // column so submissions are never hidden behind target publications
  await expect(row2027.locator('td').nth(8)).toHaveText('6');
  await expect(row2027.locator('td').nth(9)).toHaveText('5');
});

test('pipeline kanban shows all 8 seeded papers, redacted private repos, and the target journal matrix', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Future Papers Pipeline/ }).click();

  for (const title of PLANNED_PAPER_TITLES) {
    await expect(page.locator('article').filter({ hasText: title })).toBeVisible();
  }

  // csis private repositories were redacted to empty URLs at export time and
  // must render as non-interactive "(Private)" chips, never as broken links.
  const csisCard = page
    .locator('article')
    .filter({ hasText: 'Critical Safety Issues v2' });
  await expect(csisCard.locator('span').filter({ hasText: '(Private)' })).toHaveCount(2);
  await expect(csisCard.locator('a[href=""]')).toHaveCount(0);
  await expect(
    csisCard.getByText('CSIS v2 national modelling pipeline (private) (Private)')
  ).toBeVisible();

  // Switch to the Target Journal Matrix view: one row per seeded paper
  await page.getByRole('button', { name: 'Target Journal Matrix' }).click();
  const matrixRows = page.locator('table tbody tr');
  await expect(matrixRows).toHaveCount(8);
  await expect(matrixRows.first()).toContainText("Methods for prioritising 'bike buses'");
  await expect(page.locator('p[role="status"]')).toContainText('8 planned papers shown');
});

test('native dialogs: planned paper detail closes on Escape, publication detail light-dismisses on backdrop click', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Future Papers Pipeline/ }).click();

  // PlannedPaperDetailDialog opened from a kanban card
  await page.getByRole('button', { name: /bike buses/ }).click();
  const plannedDialog = page.locator('dialog[open]');
  await expect(plannedDialog).toHaveCount(1);
  await expect(plannedDialog).toHaveAttribute('aria-labelledby', 'planned-detail-title');
  await expect(page.locator('#planned-detail-title')).toContainText('bike buses');

  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  // PublicationDetailDialog on the Publications tab, closed by clicking
  // outside the dialog bounding box (backdrop light dismiss)
  await page.getByRole('tab', { name: /Publications Explorer/ }).click();
  await page.locator('table tbody tr').first().locator('td.cell-title button').click();

  const pubDialog = page.locator('dialog[open]');
  await expect(pubDialog).toHaveCount(1);
  await expect(pubDialog).toHaveAttribute('aria-labelledby', 'pub-detail-title');
  await expect(page.locator('#pub-detail-title')).toBeVisible();

  const box = await pubDialog.boundingBox();
  expect(box).not.toBeNull();
  // Modal dialog must be horizontally centred (margin: auto restored over Tailwind v4 preflight)
  expect(box!.x).toBeGreaterThan(20);
  await page.mouse.click(5, 5);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('idea composer saves a local draft that persists across reloads and emits YAML + CLI snippets', async ({
  page
}) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New Paper Idea' }).first().click();
  const composer = page.locator('dialog[open]');
  await expect(composer).toHaveAttribute('aria-labelledby', 'idea-composer-title');

  await composer.locator('#idea-title').fill('Autonomous Micromobility Safety Appraisal');
  await composer.locator('#idea-category').selectOption('flagship-project');
  await composer.locator('#idea-quarter').fill('2027-Q3');
  await composer.locator('#idea-year').fill('2028');
  await composer.locator('#idea-journal-1').fill('Journal of Transport Geography');

  await composer.getByRole('button', { name: 'Save to Dashboard Preview' }).click();

  // Persistence preview disclosure stays live inside the still-open dialog
  await composer.locator('details summary').filter({ hasText: 'Persist to Repository' }).click();
  const cliSnippet = composer.locator('pre[aria-label="Ready to run add-idea CLI command"]');
  const yamlSnippet = composer.locator('pre[aria-label="Ready to paste planned papers YAML entry"]');
  await expect(cliSnippet).toContainText(
    "npx @researchhq/cli add-idea --slug 'autonomous-micromobility-safety-appraisal'"
  );
  await expect(cliSnippet).toContainText("--submission-quarter '2027-Q3'");
  await expect(cliSnippet).toContainText('--publication-year 2028');
  await expect(cliSnippet).toContainText("--journal 'Journal of Transport Geography'");
  await expect(yamlSnippet).toContainText('- slug: "autonomous-micromobility-safety-appraisal"');
  await expect(yamlSnippet).toContainText('category: flagship-project');
  await expect(yamlSnippet).toContainText('targetSubmissionQuarter: "2027-Q3"');
  await expect(yamlSnippet).toContainText('targetPublicationYear: 2028');

  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  // The idea joins the Kanban board immediately as a Local Draft
  const draftCard = page
    .locator('article')
    .filter({ hasText: 'Autonomous Micromobility Safety Appraisal' });
  await expect(draftCard).toBeVisible();
  await expect(draftCard.getByText('Local Draft')).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(() =>
        JSON.parse(
          window.localStorage.getItem('researchhq-local-ideas-v2:0000-0001-5679-6536') ?? '[]'
        )
      )
    )
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'autonomous-micromobility-safety-appraisal',
          category: 'flagship-project',
          targetSubmissionQuarter: '2027-Q3',
          targetPublicationYear: 2028
        })
      ])
    );

  // The draft survives a full page reload via localStorage hydration
  await page.reload();
  await page.getByRole('tab', { name: /Future Papers Pipeline/ }).click();
  await expect(
    page.locator('article').filter({ hasText: 'Autonomous Micromobility Safety Appraisal' })
  ).toBeVisible();
});

test('publications table collapses to stacked cards at a 375x812 mobile viewport', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('tab', { name: /Publications Explorer/ }).click();

  const wrapper = page.locator('.table-wrapper:visible');
  await expect(wrapper).toBeVisible();
  const wrapperBox = await wrapper.boundingBox();
  expect(wrapperBox).not.toBeNull();
  expect(wrapperBox!.width).toBeLessThanOrEqual(375);

  // Container query kicks in below 620px: thead is visually hidden
  // (1px clipped box, so Playwright still reports it as "visible")
  const thead = page.locator('table.responsive-cards thead').first();
  await expect(thead).toHaveCSS('position', 'absolute');
  await expect(thead).toHaveCSS('width', '1px');
  await expect(thead).toHaveCSS('clip', /rect\(0px, 0px, 0px, 0px\)/);

  // Cells render stacked with data-label ::before captions
  const yearCell = page.locator('table.responsive-cards td[data-label="Year"]').first();
  await expect(yearCell).toBeVisible();
  await expect(yearCell).toHaveCSS('display', 'flex');
  const beforeContent = await yearCell.evaluate((el) => getComputedStyle(el, '::before').content);
  expect(beforeContent).toContain('Year');

  // No horizontal page overflow at the narrow viewport
  const scrollWidth = await page.evaluate(
    () => (document.scrollingElement ?? document.documentElement).scrollWidth
  );
  expect(scrollWidth).toBeLessThanOrEqual(375);
});

test('passes axe-core WCAG 2.1 AA accessibility checks across all five tabs in light and dark themes', async ({
  page
}) => {
  await page.goto('/');

  for (const themeLabel of ['Light', 'Dark'] as const) {
    await page.getByRole('button', { name: new RegExp(`^${themeLabel}$`) }).click();
    for (const label of TAB_LABELS) {
      await page.getByRole('tab', { name: label }).click();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const summary = results.violations.map(
        (v) => `${themeLabel} / ${label} -> ${v.id} (${v.impact}): ${v.help} [${v.nodes[0]?.html ?? ''}]`
      );
      expect(summary).toEqual([]);
    }
  }
});

test('hydrates deep-linked URL query parameters (?tab=pipeline&paper=bicischools) and syncs URL on navigation', async ({
  page
}) => {
  await page.goto('/?tab=pipeline&paper=bicischools');

  await expect(page.getByRole('tab', { name: /Future Papers Pipeline/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );

  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/bicischools/i);

  // Closing the modal strips ?paper= while preserving ?tab=pipeline
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('paper')).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('pipeline');

  // Switching back to Overview returns to a clean query string
  await page.getByRole('tab', { name: /Overview & Open Science/ }).click();
  await expect.poll(() => new URL(page.url()).search).toBe('');
});

test('quick percent-complete updater (+10% card button, modal range/CLI snippet, persistence & reset)', async ({
  page
}) => {
  await page.goto('/?tab=pipeline');

  const openScienceCard = page
    .locator('article')
    .filter({ hasText: 'The five stages of open and reproducible science' });
  await expect(openScienceCard).toContainText('Percent complete: 40%');

  await openScienceCard
    .getByRole('button', { name: /Increase percent complete.*: \+10%/ })
    .click();
  await expect(openScienceCard).toContainText('Percent complete: 50%');
  await expect(openScienceCard.getByText('Modified locally')).toBeVisible();

  // Survives full page reload via localStorage
  await page.reload();
  const reloadedCard = page
    .locator('article')
    .filter({ hasText: 'The five stages of open and reproducible science' });
  await expect(reloadedCard).toContainText('Percent complete: 50%');

  // Open detail dialog, inspect live CLI update-idea snippet, and reset to baseline
  await reloadedCard
    .getByRole('button', { name: /The five stages of open and reproducible science/ })
    .click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  const cliPre = dialog.locator('pre[aria-label="Ready to run update-idea CLI command"]');
  await expect(cliPre).toContainText(
    "npx @researchhq/cli update-idea --slug 'five-stages-open-science' --readiness 50"
  );

  await dialog.getByRole('button', { name: 'Reset' }).click();
  await expect(cliPre).toContainText('--readiness 40');
  await page.keyboard.press('Escape');
  await expect(reloadedCard).toContainText('Percent complete: 40%');
});

test('renders Schema.org JSON-LD, FWCI + Open Science upgrade opportunities, and ?embed=1 compact mode', async ({
  page
}) => {
  await page.goto('/');

  // Schema.org JSON-LD @graph in <head>
  const jsonLdRaw = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent();
  expect(jsonLdRaw).not.toBeNull();
  const parsedLd = JSON.parse(jsonLdRaw!);
  expect(parsedLd['@context']).toBe('https://schema.org');
  expect(Array.isArray(parsedLd['@graph'])).toBe(true);
  expect(parsedLd['@graph'][0]['@type']).toBe('Person');

  // FWCI summary and Open Science Upgrade Opportunities disclosure
  await expect(page.getByText(/Median FWCI \d+\.\d+x/)).toBeVisible();
  const upgradesSummary = page
    .locator('details summary')
    .filter({ hasText: /Open Science Upgrade Opportunities/ });
  await expect(upgradesSummary).toBeVisible();
  await upgradesSummary.click();
  await expect(page.getByRole('button', { name: /Copy YAML override/ }).first()).toBeVisible();

  // ?embed=1 compact mode hides footer and header New Paper Idea CTA
  await page.goto('/?embed=1');
  await expect(page.locator('[data-embed-mode="true"]')).toBeVisible();
  await expect(page.locator('footer')).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: 'New Paper Idea' })).toHaveCount(
    0
  );
});

test('supports ?demo=1 synthetic multi-researcher persona fixture cleanly', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.locator('h1#dashboard-title')).toContainText('Dr Alex Rivera (Demo Persona)');
  await expect(page.getByRole('button', { name: 'Exit synthetic demo' })).toBeVisible();
});

test('D2: ?demo=1 uses its own storage namespace and never inherits local % complete overrides', async ({
  page
}) => {
  // Seed a Robin-namespace progress override (as if saved earlier this session)
  await page.goto('/');
  await page.locator('[data-hydrated="true"]').waitFor();
  await page.evaluate(() => {
    window.localStorage.setItem(
      'researchhq-paper-progress-v2:0000-0001-5679-6536',
      JSON.stringify({
        'demo-multimodal-equity': { readinessPercent: 99, baseReadinessPercent: 75 }
      })
    );
    window.localStorage.setItem('researchhq-local-ideas-v2:0000-0001-5679-6536', '[]');
  });

  await page.goto('/?demo=1');
  await expect(page.locator('h1#dashboard-title')).toContainText('Dr Alex Rivera (Demo Persona)');
  await page.getByRole('tab', { name: /Future Papers Pipeline/ }).click();

  // The demo persona's paper keeps its repository readiness (75%); Robin's
  // namespaced 99% override must not leak into the demo namespace
  await expect(page.locator('article').filter({ hasText: 'Percent complete: 99%' })).toHaveCount(
    0
  );
  await expect(page.locator('article').filter({ hasText: 'Percent complete: 75%' })).toBeVisible();
});

test('D4: copied YAML override snippet is paste-safe with no top-level overrides wrapper', async ({
  page
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');

  const upgradesSummary = page
    .locator('details summary')
    .filter({ hasText: /Open Science Upgrade Opportunities/ });
  await upgradesSummary.scrollIntoViewIfNeeded();
  await upgradesSummary.click();
  await page.getByRole('button', { name: 'Copy YAML override' }).first().click();

  const snippet = await page.evaluate(() => navigator.clipboard.readText());
  // No top-level `overrides:` wrapper: pasting into an existing overrides.yaml stays valid YAML
  expect(snippet).not.toMatch(/^overrides:/m);
  // Entry key is 2-space indented and suffixed with the publication id
  expect(snippet).toMatch(/^ {2}[a-z0-9-]+-w\d+:$/m);
  // Stage assertion is a comment so pasting unedited cannot claim an unearned stage
  expect(snippet).toContain('# openScienceStage:');
});
