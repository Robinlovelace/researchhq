import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the @researchhq/dashboard static production build.
 *
 * The webServer builds the SvelteKit adapter-static output with an empty base
 * path (RESEARCHHQ_BASE_PATH="") and serves it through `vite preview` on a
 * strict port so every test runs against the real production bundle.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4179'
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'RESEARCHHQ_BASE_PATH="" npm run build && npx vite preview --port 4179 --strictPort',
    url: 'http://localhost:4179',
    reuseExistingServer: false,
    timeout: 240_000
  }
});
