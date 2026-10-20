import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-marketplace-admin", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.MARKETPLACE_ADMIN_BROWSER_URL || "http://127.0.0.1:4180",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
