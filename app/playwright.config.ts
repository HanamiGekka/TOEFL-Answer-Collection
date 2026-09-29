import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:1421',
    trace: 'retain-on-failure',
    viewport: { width: 720, height: 900 }
  },
  projects: [
    {
      name: 'chromium-right-half-screen',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' }
    }
  ],
  webServer: {
    command: 'npm run dev -- --port 1421',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: false,
    timeout: 120_000
  }
});
