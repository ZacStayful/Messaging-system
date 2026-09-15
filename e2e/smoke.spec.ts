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

test("the app is dark-only", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Toggle dark mode" })).toHaveCount(0);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(30, 43, 28)");
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

test("reply in a thread, see it in the Threads view and deep-link back", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "hover actions are desktop-only in this test");
  await signIn(context, "test-staff@stayful.test");
  await page.goto(`/home/${TEAM_ONLY}`);

  const body = `thread parent ${Date.now()}`;
  await page.getByPlaceholder("Message #test-internal").fill(body);
  await page.keyboard.press("Enter");
  const row = page.locator("article", { hasText: body });
  await expect(row).toBeVisible();
  await expect(page.getByText("Sending…")).toHaveCount(0, { timeout: 10_000 });

  // Open the thread panel from the hover action and reply.
  await row.hover();
  await row.getByRole("button", { name: "Reply in thread" }).click();
  const panel = page.getByRole("region", { name: "Thread" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(body)).toBeVisible();
  await expect(panel.getByText("No replies yet")).toBeVisible();
  const reply = `thread reply ${Date.now()}`;
  await panel.getByPlaceholder("Reply…").fill(reply);
  await page.keyboard.press("Enter");
  await expect(panel.getByText(reply)).toBeVisible();
  await expect(panel.getByText("Sending…")).toHaveCount(0, { timeout: 10_000 });
  await expect(panel.getByText("1 reply", { exact: true })).toBeVisible();
  // The reply stays out of the main timeline; the parent shows a reply summary instead.
  await expect(page.locator("article", { hasText: reply })).toHaveCount(1);
  await expect(row.getByRole("button", { name: /1 reply/ })).toBeVisible();
  await panel.getByRole("button", { name: "Close thread" }).click();
  await expect(panel).toHaveCount(0);

  // Threads view lists it and links back into the conversation with the panel open.
  await page
    .getByRole("link", { name: /Threads/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/threads$/);
  const card = page.getByRole("link", { name: new RegExp(body) });
  await expect(card).toBeVisible();
  await expect(card.getByText("#test-internal")).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/home/${TEAM_ONLY}\\?thread=`));
  await expect(page.getByRole("region", { name: "Thread" }).getByText(reply)).toBeVisible();

  // A deep link to the reply itself opens the thread too.
  await page.goto(`/home/${TEAM_ONLY}`);
  await expect(page.getByRole("region", { name: "Thread" })).toHaveCount(0);
  const replyId = await page.evaluate(
    (text) => Array.from(document.querySelectorAll("article")).find((a) => a.textContent?.includes(text))?.id,
    body,
  );
  expect(replyId).toMatch(/^m-/);
  await page.goto(`/home/${TEAM_ONLY}?thread=${replyId!.slice(2)}`);
  await expect(page.getByRole("region", { name: "Thread" }).getByText(reply)).toBeVisible();
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

test("customers get the simplified shell and no team routes", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(context, "test-customer@stayful.test");
  await page.goto("/home");
  await expect(page.getByText("Your groups")).toBeVisible();
  await expect(page.getByRole("link", { name: /test-customer/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Activity" })).toHaveCount(0);
  await expect(page.getByLabel("Search Stayful")).toHaveCount(0);
  for (const path of ["/search", "/activity", "/files", "/later", "/team/new"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
  await page.goto(`/home/${CUSTOMER_GROUP}`);
  await expect(page.getByText("Hello from the team (public)")).toBeVisible();
  // Customers can DM anyone in their group from the members list
  await page.getByRole("button", { name: /\d+ members/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Message Test Staff" }).click();
  await expect(page).toHaveURL(/\/dms\/[0-9a-f-]{36}/);
});

test("header menu sets notification level and group settings rename + archive", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(context, "test-staff@stayful.test");
  const name = `e2e-settings-${Date.now()}`;
  await page.goto("/home");
  await page.getByRole("button", { name: "New message" }).first().click();
  await page.getByRole("tab", { name: "Create a group" }).click();
  await page.getByLabel("Group name").fill(name);
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/home\/[0-9a-f-]{36}/);

  await page.getByRole("button", { name: "Notification preferences" }).click();
  await page.getByRole("menuitem", { name: "Mentions only" }).click();
  await expect(page.getByRole("button", { name: "Notification preferences" })).toHaveAttribute(
    "title",
    /Mentions only/,
  );

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Group settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Group name").fill(`${name}-renamed`);
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText(`renamed the group from #${name} to #${name}-renamed`)).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Archive group" }).click();
  await expect(page.getByText("This group is archived")).toBeVisible({ timeout: 10_000 });
});

test("sidebar row context menu: star, mute and notification level", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "context menus are desktop-only in this test");
  await signIn(context, "test-staff@stayful.test");
  await page.goto(`/home/${TEAM_ONLY}`);
  const row = page.getByRole("link", { name: /test-internal/ }).first();
  await expect(row).toBeVisible();

  // Right-click opens the menu; Star moves the row into the Starred section.
  await row.click({ button: "right" });
  const menu = page.getByRole("dialog", { name: /Options for test-internal/ });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Star", exact: true }).click();
  await expect(page.getByText("Starred", { exact: true })).toBeVisible();

  // The hover "⋯" button opens the same menu; switch notification level via the sub-view.
  await row.hover();
  await row.getByRole("button", { name: /Options for test-internal/ }).click();
  await menu.getByRole("menuitem", { name: /Notification preferences/ }).click();
  await menu.getByRole("menuitem", { name: "Mentions only" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Notification preferences" })).toHaveAttribute(
    "title",
    "Notifications: Mentions only",
  );

  // Undo: unstar and reset the level so the fixture stays neutral.
  await row.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Remove from starred" }).click();
  await expect(page.getByText("Starred", { exact: true })).toHaveCount(0);
  await row.click({ button: "right" });
  await menu.getByRole("menuitem", { name: /Notification preferences/ }).click();
  await menu.getByRole("menuitem", { name: "All new messages" }).click();
});

test("status, profile card and people directory", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(context, "test-staff@stayful.test");

  // Set a status from the You panel.
  await page.goto("/you");
  await page.getByRole("button", { name: "Set a status" }).click();
  const dialog = page.getByRole("dialog", { name: "Set a status" });
  await dialog.getByLabel("Status text").fill("In a meeting");
  await dialog.getByLabel("Clear status after").selectOption("1h");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /In a meeting/ })).toBeVisible();

  // The people directory lists everyone, filters, and opens a profile card with the status.
  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Profile: Test Customer" })).toBeVisible();
  await page.getByLabel("Search people").fill("test staff");
  await expect(page.getByRole("button", { name: "Profile: Test Customer" })).toHaveCount(0);
  await page.getByRole("button", { name: "Profile: Test Staff" }).click();
  const card = page.getByRole("dialog", { name: "Profile: Test Staff" });
  await expect(card).toBeVisible();
  await expect(card.getByText("In a meeting")).toBeVisible();
  await expect(card.getByRole("link", { name: "Edit profile" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Clicking a sender's name in a conversation opens their card with a Message button.
  await page.goto(`/home/${CUSTOMER_GROUP}`);
  await page.getByRole("button", { name: "Test Staff", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Profile: Test Staff" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Clear the status again so the fixture stays neutral.
  await page.goto("/you");
  await page.getByRole("button", { name: "Clear status" }).click();
  await expect(page.getByRole("button", { name: "Set a status" })).toBeVisible();
});

test("customers cannot open the people directory", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "one run is enough");
  await signIn(context, "test-customer@stayful.test");
  const res = await page.goto("/people");
  expect(res?.status()).toBe(404);
});

test("history and help popovers open from the top bar", async ({ page, context }, testInfo) => {
  needsFixtures();
  test.skip(testInfo.project.name !== "desktop", "top bar is desktop-only");
  await signIn(context, "test-staff@stayful.test");
  await page.goto(`/home/${TEAM_ONLY}`);
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("dialog", { name: "Recent conversations" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
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
