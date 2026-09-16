import { afterEach, describe, expect, it } from "vitest";
import { messageWhatsApp } from "@/lib/whatsapp/templates";
import { dryRun, sendWhatsApp, whatsappApiBase, whatsappConfigured } from "@/lib/whatsapp/timelines";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("messageWhatsApp", () => {
  const base = {
    senderName: "Sarah Hill",
    body: "The photos are booked for Tuesday.",
    conversationTitle: "#nick-clarke",
    isGroup: true,
    viewUrl: "https://chat.stayful.co.uk/home/abc",
  };

  it("names the author, because one number serves the whole company", () => {
    const { text } = messageWhatsApp(base);
    expect(text).toContain("*Sarah Hill*");
    expect(text).toContain("#nick-clarke");
  });

  it("uses WhatsApp markup, not HTML", () => {
    const { text } = messageWhatsApp(base);
    expect(text).not.toMatch(/<[a-z/]/i);
    expect(text).toMatch(/^\*/);
  });

  it("carries the message itself, not just a nudge to go and look", () => {
    const { text } = messageWhatsApp(base);
    expect(text).toContain("The photos are booked for Tuesday.");
    expect(text).toContain(base.viewUrl);
  });

  it("drops the group name for a direct message", () => {
    const { text } = messageWhatsApp({ ...base, isGroup: false });
    expect(text).toContain("*Sarah Hill*");
    expect(text).not.toContain("#nick-clarke");
  });

  it("trims a very long message rather than sending a wall of text", () => {
    const { text } = messageWhatsApp({ ...base, body: "x".repeat(5000) });
    expect(text.length).toBeLessThan(1100);
    expect(text).toContain("…");
    expect(text).toContain(base.viewUrl);
  });

  it("does not leave ragged blank lines when the body has its own spacing", () => {
    const { text } = messageWhatsApp({ ...base, body: "\n\n  Hello  \n\n" });
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).toContain("Hello");
  });
});

describe("timelines adapter", () => {
  it("is not configured without a token", () => {
    delete process.env.TIMELINES_API_TOKEN;
    delete process.env.TIMELINES_DRY_RUN;
    expect(whatsappConfigured()).toBe(false);
  });

  it("counts dry-run as configured, so the drain can be exercised offline", () => {
    delete process.env.TIMELINES_API_TOKEN;
    process.env.TIMELINES_DRY_RUN = "1";
    expect(dryRun()).toBe(true);
    expect(whatsappConfigured()).toBe(true);
  });

  it("reports skipped rather than failed when there is no token", async () => {
    delete process.env.TIMELINES_API_TOKEN;
    delete process.env.TIMELINES_DRY_RUN;
    const res = await sendWhatsApp({ to: "+447957516879", text: "hi" });
    // skipped matters: the drain leaves the row pending instead of burning an attempt.
    expect(res).toMatchObject({ ok: false, skipped: true });
  });

  it("succeeds without a request in dry-run", async () => {
    process.env.TIMELINES_DRY_RUN = "1";
    const res = await sendWhatsApp({ to: "+447957516879", text: "hi" });
    expect(res.ok).toBe(true);
    expect(res.id).toMatch(/^dry-run-/);
  });

  it("defaults to the documented base and tolerates a trailing slash", () => {
    delete process.env.TIMELINES_API_BASE;
    expect(whatsappApiBase()).toBe("https://app.timelines.ai/integrations/api");
    process.env.TIMELINES_API_BASE = "https://stub.test/api/";
    expect(whatsappApiBase()).toBe("https://stub.test/api");
  });
});
