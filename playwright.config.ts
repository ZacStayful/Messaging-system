import { defineConfig, devices } from "@playwright/test";

const port = 3100;
// Sandboxes with a preinstalled Chromium can point Playwright at it instead of downloading one.
const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined;
// Sandboxes that route HTTPS through a proxy with its own CA can allow-list that CA's
// SPKI hash (base64 SHA-256) instead of disabling certificate checks.
const spkiAllowList = process.env.PW_CERT_SPKI_ALLOWLIST;
const launchArgs = spkiAllowList ? [`--ignore-certificate-errors-spki-list=${spkiAllowList}`] : [];
// Some sandbox proxies cannot upgrade WebSockets; PW_DIRECT=1 lets the test browser connect directly.
if (process.env.PW_DIRECT) launchArgs.push("--no-proxy-server");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    launchOptions: { executablePath, args: launchArgs },
  },
  webServer: {
    command: `pnpm exec next start -p ${port}`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
