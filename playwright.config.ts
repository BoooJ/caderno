import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:5197", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "iphone",
      use: { ...devices["iPhone 13"], defaultBrowserType: "webkit" },
    },
  ],
  webServer: [
    {
      command: "node server/index.mjs",
      url: "http://127.0.0.1:3090/api/session",
      env: { APP_ORIGIN: "http://localhost:5197", DATA_DIR: "test-results/ui-data" },
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "npx vite --host 127.0.0.1 --port 5197",
      url: "http://localhost:5197",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
