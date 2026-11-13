import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage for the ResearchHQ dashboard static production build.
 *
 * Every assertion is grounded in the app's actual markup and in the default
 * synthetic example dataset (packages/dashboard/static/data/portfolio.json,
 * identical to demo-portfolio.json):
 *   - Dr Alex Rivera (Demo Persona), OpenAlex citations 176 vs Google Scholar 218
 *   - OpenTransitMap: 84 OpenAlex vs 98 Scholar; book: 31 vs 45
 *   - Journal of Transport Geography: JIF 6.80 (2025 JCR), Q1, hybrid provenance
 *   - 2021..2028 time series (8 bars), 2 planned papers (75% / 45%)
 *   - /researchhq/ renders the OSS software-project banner for the example
 *     persona; real deployments (e.g. /research/) stay portfolio-only.
 */

const TAB_LABELS = [
  'Overview & Open Science',
  'Time Series (Past & Future)',
  'Journals & Impact Metrics',
  'Publications Explorer',
  'Future Papers Pipeline'
];

const DEMO_ORCID = '0000-0002-1825-0097';
const ROBIN_ORCID = '0000-0001-5679-6536';

const PLANNED_PAPER_TITLES = [
  'Dynamic multimodal accessibility budgets under climate disruption scenarios',
  'Open benchmark datasets for municipal kerbside and micromobility allocation'
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

/** The OSS software-project banner (only rendered for the example persona). */
function ossBanner(page: Page) {
  return page.locator('section[aria-label="ResearchHQ open-source software overview"]');
}

test('loads with zero console errors, a skip link, the demo persona h1 and all five tab buttons', async ({
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
  await expect(h1).toContainText('Dr Alex Rivera (Demo Persona)');

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  for (const label of TAB_LABELS) {
    await expect(page.getByRole('tab', { name: new RegExp(label.replace(/[&()]/g, '\\$&')) })).toBeVisible();
  }

  await expect(page.locator('#panel-overview')).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('default deployment is the ResearchHQ OSS project site: banner, page title, and no no-op demo toggle', async ({
  page
}) => {
  await page.goto('/');

  const banner = ossBanner(page);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('ResearchHQ: Open-Source Academic Portfolio Toolkit');
  await expect(banner).toContainText('@researchhq/cli');
  await expect(banner).toContainText('@researchhq/schema');
  await expect(banner).toContainText('@researchhq/dashboard');
  await expect(banner).toContainText('npx @researchhq/cli init && npx @researchhq/cli sync');
  await expect(banner).toContainText('Exploring synthetic example dataset: Dr Alex Rivera (Demo Persona)');

  await expect(
    banner.getByRole('link', { name: 'GitHub Repository' })
  ).toHaveAttribute('href', 'https://github.com/Robinlovelace/researchhq');
  await expect(
    banner.getByRole('link', { name: /Live real-world example \(Prof\. Robin Lovelace\)/ })
  ).toHaveAttribute('href', 'https://robinlovelace.net/research/');

  // The default snapshot IS the demo persona: a "Switch to synthetic OSS demo"
  // footer button would be a no-op toggle, so it must not render.
  await expect(page.locator('footer').getByRole('button', { name: /synthetic demo/ })).toHaveCount(
    0
  );

  await expect(page).toHaveTitle(
    'ResearchHQ - Open-Source Academic Portfolio & Planned Papers Dashboard (Example Demo)'
  );
});

test('citation source switcher reactively updates KPI and per-publication citation numbers', async ({
  page
}) => {
  await page.goto('/');
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();

  const selector = page.locator('#citation-source-select');

  // Only single-source options exist (no 'best' / 'Max' mixed option)
  const options = selector.locator('option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute('value', 'openalex');
  await expect(options.nth(0)).toHaveText('OpenAlex');
  await expect(options.nth(1)).toHaveAttribute('value', 'scholar');
  await expect(options.nth(1)).toHaveText('Google Scholar');
  await expect(selector.locator('option[value="best"]')).toHaveCount(0);

  // Defaults to pure OpenAlex
  await expect(selector).toHaveValue('openalex');
  await expect(citationsKpi(page)).toHaveText('176');
  await expect(
    page.locator('li').filter({ hasText: 'OpenTransitMap' }).locator('span.tabular-nums')
  ).toHaveText('84');
  const demoBookItems = page
    .locator('li:visible')
    .filter({ hasText: 'Reproducible Urban Mobility Analytics' });
  await expect(demoBookItems.first()).toContainText('2025');
  await expect(demoBookItems.filter({ hasText: '31 citations' }).first()).toBeVisible();

  // Switch to Google Scholar: author-level total and per-work citations
  await selector.selectOption('scholar');
  await expect(selector).toHaveValue('scholar');
  await expect(citationsKpi(page)).toHaveText('218');
  await expect(
    page.locator('li').filter({ hasText: 'OpenTransitMap' }).locator('span.tabular-nums')
  ).toHaveText('98');
  await expect(demoBookItems.filter({ hasText: '45 citations' }).first()).toBeVisible();
  await expect(demoBookItems.filter({ hasText: '31 citations' })).toHaveCount(0);

  // Switch back to OpenAlex
  await selector.selectOption('openalex');
  await expect(selector).toHaveValue('openalex');
  await expect(citationsKpi(page)).toHaveText('176');
  await expect(
    page.locator('li').filter({ hasText: 'OpenTransitMap' }).locator('span.tabular-nums')
  ).toHaveText('84');
  await expect(demoBookItems.filter({ hasText: '31 citations' }).first()).toBeVisible();
  await expect(demoBookItems.filter({ hasText: '45 citations' })).toHaveCount(0);

  // The KPI helper text always names both sources
  await expect(page.getByText(/OpenAlex: 176 · Scholar: 218\+/)).toBeVisible();
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
  await expect(tbody.locator('tr')).toHaveCount(1);
  await expect(tbody).toContainText('OpenTransitMap');
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
  await expect(page.locator('p').filter({ hasText: /Showing/ })).toContainText('1 of 1 publications');
});

test('time series renders 8 yearly bars for 2021-2028, planned markers and an accessible table', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Time Series \(Past & Future\)/ }).click();

  const chart = page.locator('svg[aria-labelledby="ts-svg-title ts-svg-desc"]');
  const bars = chart.locator('g[role="button"]');
  await expect(bars).toHaveCount(8);

  // Historical bars carry aria labels with published counts
  await expect(bars.first()).toHaveAttribute(
    'aria-label',
    '2021: 1 published (1 articles), 0 planned submissions, 0 planned publications'
  );

  // Future planned markers for 2027 and 2028 (the only isFuture years in the
  // example snapshot); 2026 is the current year and shows its in-flight
  // planned submissions bar instead.
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
  // Seeded 2027 plan: 1 submission and 2 target publications, each in its own
  // column so submissions are never hidden behind target publications
  await expect(row2027.locator('td').nth(8)).toHaveText('1');
  await expect(row2027.locator('td').nth(9)).toHaveText('2');
});

test('pipeline kanban shows both example papers, the redacted private repo chip, and the target journal matrix', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Future Papers Pipeline/ }).click();

  for (const title of PLANNED_PAPER_TITLES) {
    await expect(page.locator('article').filter({ hasText: title })).toBeVisible();
  }

  // The example private repository has an empty URL at export time and must
  // render as a non-interactive "(Private)" chip, never as a broken link.
  const diamondCard = page
    .locator('article')
    .filter({ hasText: 'Open benchmark datasets' });
  await expect(diamondCard.locator('span').filter({ hasText: '(Private)' })).toHaveCount(1);
  await expect(diamondCard.locator('a[href=""]')).toHaveCount(0);
  await expect(diamondCard.getByText('Partner data embargoed (Private)')).toBeVisible();

  // Switch to the Target Journal Matrix view: one row per example paper
  await page.getByRole('button', { name: 'Target Journal Matrix' }).click();
  const matrixRows = page.locator('table tbody tr');
  await expect(matrixRows).toHaveCount(2);
  await expect(matrixRows.first()).toContainText('Dynamic multimodal accessibility budgets');
  await expect(page.locator('p[role="status"]')).toContainText('2 planned papers shown');
});

test('native dialogs: planned paper detail closes on Escape, publication detail light-dismisses on backdrop click', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Future Papers Pipeline/ }).click();

  // PlannedPaperDetailDialog opened from a kanban card
  await page.getByRole('button', { name: /multimodal accessibility budgets/ }).click();
  const plannedDialog = page.locator('dialog[open]');
  await expect(plannedDialog).toHaveCount(1);
  await expect(plannedDialog).toHaveAttribute('aria-labelledby', 'planned-detail-title');
  await expect(page.locator('#planned-detail-title')).toContainText('multimodal accessibility budgets');

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
          window.localStorage.getItem('researchhq-local-ideas-v2:0000-0002-1825-0097') ?? '[]'
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

test('hydrates deep-linked URL query parameters (?tab=pipeline&paper=demo-multimodal-equity) and syncs URL on navigation', async ({
  page
}) => {
  await page.goto('/?tab=pipeline&paper=demo-multimodal-equity');

  await expect(page.getByRole('tab', { name: /Future Papers Pipeline/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );

  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/multimodal accessibility budgets/i);

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

  const equityCard = page
    .locator('article')
    .filter({ hasText: 'Dynamic multimodal accessibility budgets' });
  await expect(equityCard).toContainText('Percent complete: 75%');

  await equityCard
    .getByRole('button', { name: /Increase percent complete.*: \+10%/ })
    .click();
  await expect(equityCard).toContainText('Percent complete: 85%');
  await expect(equityCard.getByText('Modified locally')).toBeVisible();

  // Survives full page reload via localStorage
  await page.reload();
  const reloadedCard = page
    .locator('article')
    .filter({ hasText: 'Dynamic multimodal accessibility budgets' });
  await expect(reloadedCard).toContainText('Percent complete: 85%');

  // Open detail dialog, inspect live CLI update-idea snippet, and reset to baseline
  await reloadedCard
    .getByRole('button', { name: /Dynamic multimodal accessibility budgets/ })
    .click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  const cliPre = dialog.locator('pre[aria-label="Ready to run update-idea CLI command"]');
  await expect(cliPre).toContainText(
    "npx @researchhq/cli update-idea --slug 'demo-multimodal-equity' --readiness 85"
  );

  await dialog.getByRole('button', { name: 'Reset' }).click();
  await expect(cliPre).toContainText('--readiness 75');
  await page.keyboard.press('Escape');
  await expect(reloadedCard).toContainText('Percent complete: 75%');
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

  // ?embed=1 compact mode hides the OSS banner, footer, and header CTA
  await page.goto('/?embed=1');
  await expect(page.locator('[data-embed-mode="true"]')).toBeVisible();
  await expect(ossBanner(page)).toHaveCount(0);
  await expect(page.locator('footer')).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: 'New Paper Idea' })).toHaveCount(
    0
  );
});

test('?demo=1 resolves to the same synthetic fixture with the OSS banner and no no-op toggle', async ({
  page
}) => {
  await page.goto('/?demo=1');
  await expect(page.locator('h1#dashboard-title')).toContainText('Dr Alex Rivera (Demo Persona)');
  await expect(ossBanner(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /synthetic demo/ })).toHaveCount(0);
});

test('D2: local progress overrides namespace under the active persona ORCID and never leak across personas', async ({
  page
}) => {
  await page.goto('/');
  await page.locator('[data-hydrated="true"]').waitFor();

  // Seed a Robin-namespace override (as if saved earlier in a real-persona
  // session on the same origin): it must have zero effect on the demo view.
  await page.evaluate((orcid) => {
    window.localStorage.setItem(
      `researchhq-paper-progress-v2:${orcid}`,
      JSON.stringify({
        'demo-multimodal-equity': { readinessPercent: 99, baseReadinessPercent: 75 }
      })
    );
  }, ROBIN_ORCID);

  await page.goto('/?tab=pipeline');
  await expect(page.locator('article').filter({ hasText: 'Percent complete: 99%' })).toHaveCount(
    0
  );
  await expect(page.locator('article').filter({ hasText: 'Percent complete: 75%' })).toBeVisible();

  // The demo persona's own namespace does accept and apply the same override,
  // proving the read path is namespaced by the active snapshot's ORCID.
  await page.evaluate((orcid) => {
    window.localStorage.setItem(
      `researchhq-paper-progress-v2:${orcid}`,
      JSON.stringify({
        'demo-multimodal-equity': { readinessPercent: 99, baseReadinessPercent: 75 }
      })
    );
  }, DEMO_ORCID);

  await page.goto('/?tab=pipeline');
  await expect(page.locator('article').filter({ hasText: 'Percent complete: 99%' })).toBeVisible();
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
  // (the example ids demo-*-w1001..w1004 keep override keys machine-matchable)
  expect(snippet).toMatch(/^ {2}[a-z0-9-]+-w\d+:$/m);
  // Stage assertion is a comment so pasting unedited cannot claim an unearned stage
  expect(snippet).toContain('# openScienceStage:');
});
