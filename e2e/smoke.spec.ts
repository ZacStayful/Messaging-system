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

const FIXTURES = !!(URL && KEY && PASSWORD);
const needsFixtures = () => test.skip(!FIXTURES, "needs a seeded database and SEED_TEST_PASSWORD in .env.local");

test("unauthenticated users land on the login page", async ({ page }) => {
  await page.goto("/dms");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in to Stayful" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("staff can browse, open a channel and send a message", async ({ page, context }, testInfo) => {
  needsFixtures();
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
  needsFixtures();
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
  needsFixtures();
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
  needsFixtures();
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
  needsFixtures();
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
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(context, "test-customer@stayful.test");
  const res = await page.goto("/customers/new");
  expect(res?.status()).toBe(404);
});

test("react, pin, edit and delete a message", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "hover actions are desktop-only in this test");
  await signIn(context, "test-staff@stayful.test");
  await page.goto(`/home/${TEAM_ONLY}`);

  const body = `actions ${Date.now()}`;
  await page.getByPlaceholder("Message #test-internal").fill(body);
  await page.keyboard.press("Enter");
  const row = page.locator("article", { hasText: body });
  await expect(row).toBeVisible();
  await expect(page.getByText("Sending…")).toHaveCount(0, { timeout: 10_000 });

  // React
  await row.hover();
  await row.getByRole("button", { name: "React with 👍" }).first().click();
  const chip = row.getByRole("button", { name: "👍 1", exact: true });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await chip.click();
  await expect(chip).toHaveCount(0);

  // Pin
  await row.hover();
  await row.getByRole("button", { name: "Pin message" }).click();
  await expect(row.getByText("Pinned")).toBeVisible();
  await page.getByRole("tab", { name: /Pins/ }).click();
  await expect(page.getByText(body)).toBeVisible();
  await page.getByRole("tab", { name: /Messages/ }).click();
  await row.hover();
  await row.getByRole("button", { name: "Unpin message" }).click();
  await expect(row.getByText("Pinned")).toHaveCount(0);

  // Edit
  await row.hover();
  await row.getByRole("button", { name: "Edit message" }).click();
  await row.getByLabel("Edit message").fill(`${body} edited`);
  await page.keyboard.press("Enter");
  await expect(row.getByText(`${body} edited`)).toBeVisible();
  await expect(row.getByText("(edited)")).toBeVisible({ timeout: 10_000 });

  // Delete
  await row.hover();
  await row.getByRole("button", { name: "Delete message" }).click();
  await page.getByRole("dialog", { name: "Delete this message?" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("article", { hasText: body })).toHaveCount(0);
});

test("attach a photo and a file to a message", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(context, "test-staff@stayful.test");
  await page.goto(`/home/${TEAM_ONLY}`);

  // 1x1 PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const stamp = Date.now();
  await page.getByLabel("Choose files").setInputFiles([
    { name: `photo-${stamp}.png`, mimeType: "image/png", buffer: png },
    { name: `notes-${stamp}.txt`, mimeType: "text/plain", buffer: Buffer.from("hello from playwright") },
  ]);
  await expect(page.getByRole("button", { name: `Remove photo-${stamp}.png` })).toBeVisible();
  await page.getByPlaceholder("Message #test-internal").fill(`files ${stamp}`);
  await page.keyboard.press("Enter");

  const row = page.locator("article", { hasText: `files ${stamp}` });
  await expect(row.getByRole("button", { name: `Open photo-${stamp}.png` })).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText(`notes-${stamp}.txt`)).toBeVisible();
  await expect(row.getByText("Uploading…")).toHaveCount(0, { timeout: 20_000 });
  await expect(row.getByText("Upload failed")).toHaveCount(0);

  await page.getByRole("tab", { name: /Files and links/ }).click();
  await expect(page.getByText(`notes-${stamp}.txt`)).toBeVisible();
  await expect(page.getByRole("link", { name: `photo-${stamp}.png` })).toBeVisible();
});

test("mention picker inserts a display name", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(context, "test-staff@stayful.test");
  await page.goto(`/home/${CUSTOMER_GROUP}`);
  const box = page.getByPlaceholder("Message #test-customer");
  await box.fill("hi @Test C");
  await expect(page.getByRole("option", { name: /Test Customer/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue("hi @[Test Customer] ");
  await box.fill("");
});

test("search across conversations and inside one", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(context, "test-staff@stayful.test");
  await page.goto("/dms");
  await page.getByLabel("Search Stayful").fill("Team-only channel");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  const hit = page.getByRole("link", { name: /Team-only channel message/ });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/home/${TEAM_ONLY}\\?m=`));
  await expect(page.getByText("Team-only channel message")).toBeVisible();

  await page.getByRole("button", { name: "Search in conversation" }).click();
  await page.getByRole("textbox", { name: "Search in conversation" }).fill("team-only");
  await expect(page.getByText(/1 of \d+/)).toBeVisible();
  await expect(page.locator("mark").first()).toBeVisible();
  await page.getByRole("button", { name: "Close search" }).click();
  await expect(page.locator("mark")).toHaveCount(0);
});

test("new message modal opens a DM and creates a group", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(context, "test-staff@stayful.test");
  await page.goto("/dms");
  await page.getByRole("button", { name: "New message" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New message" });
  await dialog.getByLabel("Find people").fill("Test Cust");
  await dialog.getByRole("button", { name: /Test Customer/ }).click();
  await dialog.getByRole("button", { name: /Start conversation|Open conversation/ }).click();
  await expect(page).toHaveURL(/\/dms\/[0-9a-f-]{36}/);
  await expect(page.getByPlaceholder("Message Test Customer")).toBeVisible();

  const name = `e2e-group-${Date.now()}`;
  await page.getByRole("button", { name: "New message" }).first().click();
  await page.getByRole("tab", { name: "Create a group" }).click();
  await page.getByLabel("Group name").fill(name);
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/home\/[0-9a-f-]{36}/);
  await expect(page.getByText(`Test Staff created this group.`)).toBeVisible();
});

test("API routes are never redirected to the login page", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  const cron = await request.get("/api/cron/notifications", { maxRedirects: 0 });
  expect([401, 503]).toContain(cron.status());
  const inbound = await request.post("/api/email/inbound", { data: {}, maxRedirects: 0 });
  expect([401, 503]).toContain(inbound.status());
  const unsub = await request.get("/api/email/unsubscribe?u=x&t=y", { maxRedirects: 0 });
  expect(unsub.status()).toBe(400);
});

test("auth codes that land on the site root are routed to the callback", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  const res = await request.get("/?code=not-a-real-code", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toMatch(/\/auth\/callback\?code=not-a-real-code$/);
  // The callback rejects the bogus code and sends the user to login with an error flag
  const cb = await request.get("/auth/callback?code=not-a-real-code", { maxRedirects: 0 });
  expect(cb.status()).toBe(307);
  expect(cb.headers()["location"]).toMatch(/\/login\?error=auth$/);
});
