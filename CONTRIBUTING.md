# Contributing to ResearchHQ

Contributions, bug reports, and feature enhancements that make ResearchHQ more useful for academics, research software engineers, and open-science teams are very welcome!

## Development Setup

Requirements:

- **Node.js** `>= 20.0.0` (Node 22 LTS recommended)
- **npm** `>= 10.0.0`

```bash
git clone https://github.com/Robinlovelace/researchhq.git
cd researchhq
npm install
npm run build
```

## Quality Checks

Before opening a pull request, please ensure all workspace checks pass:

```bash
# 1. Unit tests across @researchhq/schema and @researchhq/cli
npm test

# 2. Strict TypeScript + Svelte 5 type checking (must report 0 errors, 0 warnings)
npm run check

# 3. Full production static build
npm run build

# 4. End-to-end & WCAG accessibility tests (Playwright + axe-core)
npm run test:e2e -w @researchhq/dashboard
```

## Coding Conventions

- **TypeScript Strictness:** Avoid `any`; define data structures in `@researchhq/schema` first so CLI and Dashboard share a single source of truth.
- **Privacy & Security:** Never log API keys or query strings containing `api_key`. Any new sensitive field added to `PlannedPaperSchema` must be stripped in `sanitizePortfolioForPublic()` and covered by a unit test in `packages/schema/test/`.
- **Accessibility & Modern CSS:** Use native HTML semantics (`<dialog>`, `<button type="button">` inside `<th scope="col" aria-sort>`, `role="tablist"`, `@container` queries, and `color-scheme: light dark`). Ensure `@axe-core/playwright` passes with zero critical/serious violations in both light and dark themes.
- **License:** By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
