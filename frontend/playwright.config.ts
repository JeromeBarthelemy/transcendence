import { defineConfig, devices } from "@playwright/test";

// The same scenarios in the three engines the subject's browser module asks
// about: Chromium for Chrome, Gecko for Firefox, WebKit for Safari. Run
// against the production stack that scripts/e2e.sh starts and removes.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  // One stack, one database: scenarios that write must not race each other.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "https://localhost",
    // The stack's own self-signed certificate (cert-init).
    ignoreHTTPSErrors: true,
    locale: "fr-FR",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
