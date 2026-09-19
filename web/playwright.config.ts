import { defineConfig } from "@playwright/test";

// Browser tests drive the real UI against a running groundsilld. Start one with
// the built web client and point GROUNDSILL_URL at it (default :18090), e.g.
//   ./bin/groundsilld -repo /tmp/ui.git -addr 127.0.0.1:18090 -web web/dist -db "$GROUNDSILL_TEST_DSN"
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.GROUNDSILL_URL || "http://127.0.0.1:18090",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1400, height: 900 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
