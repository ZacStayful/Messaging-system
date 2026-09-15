import { test, expect, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { config } from "dotenv";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const PASSWORD = process.env.SEED_TEST_PASSWORD!;
const CUSTOMER_GROUP = "c0000000-0000-4000-8000-000000000041";
const TEAM_ONLY = "c0000000-0000-4000-8000-000000000042";

/** Signs in with the seeded test password and copies the exact auth cookies @supabase/ssr would set. */
async function signIn(context: BrowserContext, email: string) {
  const jar: { name: string; value: string }[] = [];
  const client = createServerClient(URL, KEY, {
    cookies: {
      getAll: () => jar,
      setAll: (cookies) => {
        for (const c of cookies) {
          const i = jar.findIndex((j) => j.name === c.name);
          if (i >= 0) jar[i] = { name: c.name, value: c.value };
          else jar.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(error.message);
  await context.addCookies(jar.map((c) => ({ ...c, domain: "localhost", path: "/" })));
}

test.skip(!URL || !KEY || !PASSWORD, "needs Supabase env and SEED_TEST_PASSWORD in .env.local");

test("unauthenticated users land on the login page", async ({ page }) => {
  await page.goto("/dms");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in to Stayful" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("staff can browse, open a channel and send a message", async ({ page, context }, testInfo) => {
  await signIn(context, "test-staff@stayful.test");
  await page.goto("/dms");
  await expect(page.getByText("Direct messages").first()).toBeVisible();

  await page.goto(`/home/${TEAM_ONLY}`);
  await expect(page.getByText("Team-only channel message")).toBeVisible();

  const body = `smoke ${testInfo.project.name} ${Date.now()}`;
  await page.getByPlaceholder("Message #test-internal").fill(body);
  await page.keyboard.press("Enter");
  await expect(page.getByText(body)).toBeVisible();
  await expect(page.getByText("Sending…")).toHaveCount(0, { timeout: 10_000 });
});

test("a message sent by staff reaches the customer in real time", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one realtime run is enough");
  const staffCtx = await browser.newContext();
  const customerCtx = await browser.newContext();
  await signIn(staffCtx, "test-staff@stayful.test");
  await signIn(customerCtx, "test-customer@stayful.test");
  const staff = await staffCtx.newPage();
  const customer = await customerCtx.newPage();

  await customer.goto(`/home/${CUSTOMER_GROUP}`);
  await expect(customer.getByText("Hello from the team (public)")).toBeVisible();
  // Internal notes never reach customers
  await expect(customer.getByText("Internal note: owner is price sensitive")).toHaveCount(0);

  await staff.goto(`/home/${CUSTOMER_GROUP}`);
  await expect(staff.getByText("Internal note: owner is price sensitive")).toBeVisible();

  const body = `realtime ${Date.now()}`;
  await staff.getByPlaceholder("Message #test-customer").fill(body);
  await staff.keyboard.press("Enter");

  await expect(customer.getByText(body)).toBeVisible({ timeout: 5_000 });

  await staffCtx.close();
  await customerCtx.close();
});

test("dark mode toggle persists across reload", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "rail is desktop-only");
  await signIn(context, "test-staff@stayful.test");
  await page.goto("/dms");
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("mobile shows the list with a bottom tab bar, then the conversation with a back button", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile layout only");
  await signIn(context, "test-staff@stayful.test");
  await page.goto("/home");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await page.getByRole("link", { name: /test-internal/ }).click();
  await expect(page).toHaveURL(new RegExp(`/home/${TEAM_ONLY}`));
  await expect(page.getByRole("link", { name: "Back" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
});

test("password sign-in through the login form", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await page.goto("/login");
  await page.getByLabel("Email address").fill("test-staff@stayful.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dms/);
  await page.goto("/settings/account");
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  await page.goto("/customers/new");
  await expect(page.getByRole("heading", { name: "Invite a customer" })).toBeVisible();
});

test("customers cannot open the invite page", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(context, "test-customer@stayful.test");
  const res = await page.goto("/customers/new");
  expect(res?.status()).toBe(404);
});
