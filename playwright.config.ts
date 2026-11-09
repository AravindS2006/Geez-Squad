import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/webkit-mobile.spec.ts',
  outputDir: './test-results/browser-runs',
  fullyParallel: false,
  // The real WASM model and shared SQLite fixtures contend on small CI runners.
  workers: process.env.CI ? 1 : undefined,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'msedge' } }],
  reporter: 'list',
});
