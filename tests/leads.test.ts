import { afterEach, describe, expect, it } from "vitest";
import {
  LEAD_COLUMNS,
  leadTopic,
  leadsBoardId,
  parseBoardGroups,
  parseItemsPage,
  parseLeadEmail,
  pickLeadPhone,
  type MondayLeadItem,
} from "@/lib/monday/leads";
import { outcomeFromRpcError } from "@/lib/monday/importLeads";
import { isLeadCategory, leadCategoryForGroup, leadCategoryLabel } from "@/lib/leadCategories";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("parseLeadEmail", () => {
  it("takes the first address when the free-text column holds two", () => {
    // One item on the board really has this: two addresses, space separated.
    expect(parseLeadEmail("maniproduk@gmail.com tydalproperty@gmail.com")).toBe("maniproduk@gmail.com");
  });

  it("lower-cases, because the address is the account key", () => {
    expect(parseLeadEmail("Info@passtheproperty.co.uk")).toBe("info@passtheproperty.co.uk");
  });

  it("copes with commas, semicolons and a trailing full stop", () => {
    expect(parseLeadEmail("a@b.com, c@d.com")).toBe("a@b.com");
    expect(parseLeadEmail("a@b.com; c@d.com")).toBe("a@b.com");
    expect(parseLeadEmail("someone@example.com.")).toBe("someone@example.com");
  });

  it("returns null for nothing usable", () => {
    expect(parseLeadEmail(null)).toBeNull();
    expect(parseLeadEmail("")).toBeNull();
    expect(parseLeadEmail("not an email")).toBeNull();
    expect(parseLeadEmail("call me on 07123456789")).toBeNull();
  });
});

describe("pickLeadPhone", () => {
  it("prefers Monday's phone column, which is already E.164", () => {
    expect(pickLeadPhone("+447828117537", "07828117537")).toEqual({ ok: true, e164: "+447828117537" });
  });

  it("falls back to the free-text column when the phone column is empty", () => {
    // Emanuela: only the text column is filled in.
    expect(pickLeadPhone(null, "07586031715")).toEqual({ ok: true, e164: "+447586031715" });
    expect(pickLeadPhone(null, "+44 7466 998011")).toEqual({ ok: true, e164: "+447466998011" });
  });

  it("is null, not an error, when there is no number at all", () => {
    // Pass the property: email only.
    expect(pickLeadPhone(null, null)).toBeNull();
    expect(pickLeadPhone("", "  ")).toBeNull();
  });

  it("explains a number it cannot use", () => {
    const out = pickLeadPhone(null, "0161 123 4567");
    expect(out).toMatchObject({ ok: false });
    expect(out && !out.ok ? out.error : "").toMatch(/landline/i);
  });

  it("uses the text column when the phone column is junk", () => {
    expect(pickLeadPhone("n/a", "07828117537")).toEqual({ ok: true, e164: "+447828117537" });
  });
});

describe("lead categories", () => {
  it("maps the two board groups and nothing else", () => {
    expect(leadCategoryForGroup("group_mm5f9by1")).toBe("airbnb_management");
    expect(leadCategoryForGroup("group_mm64kqtg")).toBe("r2r");
    expect(leadCategoryForGroup("topics")).toBeNull();
    expect(leadCategoryForGroup(null)).toBeNull();
  });

  it("knows its own keys", () => {
    expect(isLeadCategory("r2r")).toBe(true);
    expect(isLeadCategory("landlord")).toBe(false);
    expect(leadCategoryLabel("airbnb_management")).toBe("Airbnb management leads");
    expect(leadCategoryLabel(null)).toBeNull();
  });
});

describe("leadsBoardId", () => {
  it("defaults to the lead database board and can be overridden", () => {
    delete process.env.MONDAY_LEADS_BOARD_ID;
    expect(leadsBoardId()).toBe("18420649520");
    process.env.MONDAY_LEADS_BOARD_ID = " 123 ";
    expect(leadsBoardId()).toBe("123");
  });
});

describe("parseBoardGroups / parseItemsPage", () => {
  const column = (id: string, text: string | null) => ({ id, text });
  const data = {
    boards: [
      {
        groups: [
          {
            id: "group_mm5f9by1",
            items_page: {
              cursor: "next-1",
              items: [
                {
                  id: "12476141424",
                  name: "Myles Denton",
                  group: { id: "group_mm5f9by1" },
                  column_values: [
                    column(LEAD_COLUMNS.email, "myles@murraystays.co.uk"),
                    column(LEAD_COLUMNS.phoneText, "07828117537"),
                    column(LEAD_COLUMNS.phone, "+447828117537"),
                    column(LEAD_COLUMNS.website, "https://Www.murraystays.co.uk"),
                    column(LEAD_COLUMNS.properties, "65"),
                    column(LEAD_COLUMNS.plan, "£300/mo — 20 leads"),
                    column(LEAD_COLUMNS.status, "Management Customer"),
                    column(LEAD_COLUMNS.enquiredOn, "2026-07-08"),
                  ],
                },
                // Numeric ids and empty columns, as Monday sometimes sends them.
                { id: 42, name: "Pass the property", group: { id: "group_mm5f9by1" }, column_values: [] },
              ],
            },
          },
          { id: "group_mm64kqtg", items_page: { cursor: null, items: [] } },
        ],
      },
    ],
  };

  it("reads each group with its first page", () => {
    const groups = parseBoardGroups(data);
    expect(groups.map((g) => g.groupId)).toEqual(["group_mm5f9by1", "group_mm64kqtg"]);
    const first = parseItemsPage(groups[0].page);
    expect(first.cursor).toBe("next-1");
    expect(first.items).toHaveLength(2);
    expect(first.items[0]).toMatchObject({
      id: "12476141424",
      name: "Myles Denton",
      category: "airbnb_management",
      emailRaw: "myles@murraystays.co.uk",
      phoneRaw: "+447828117537",
      phoneTextRaw: "07828117537",
      properties: "65",
      plan: "£300/mo — 20 leads",
      enquiredOn: "2026-07-08",
    });
    expect(first.items[1]).toMatchObject({ id: "42", emailRaw: null, phoneRaw: null, phoneTextRaw: null });
    expect(parseItemsPage(groups[1].page)).toEqual({ items: [], cursor: null });
  });

  it("is empty, not broken, for a shape it does not recognise", () => {
    expect(parseBoardGroups(null)).toEqual([]);
    expect(parseBoardGroups({ boards: [] })).toEqual([]);
    expect(parseItemsPage(undefined)).toEqual({ items: [], cursor: null });
  });
});

describe("leadTopic", () => {
  const item: MondayLeadItem = {
    id: "1",
    name: "Myles Denton",
    groupId: "group_mm5f9by1",
    category: "airbnb_management",
    emailRaw: null,
    phoneRaw: null,
    phoneTextRaw: null,
    website: "https://www.murraystays.co.uk",
    properties: "65",
    plan: "£300/mo — 20 leads",
    status: null,
    enquiredOn: "2026-07-08 09:38",
  };

  it("places the person without opening Monday", () => {
    expect(leadTopic(item)).toBe(
      "Airbnb management lead · 65 properties · Plan: £300/mo — 20 leads · Enquired 2026-07-08 · https://www.murraystays.co.uk",
    );
  });

  it("keeps free-text property counts as written, and copes with nothing", () => {
    expect(leadTopic({ ...item, properties: "400+", plan: null, website: null, enquiredOn: null })).toBe(
      "Airbnb management lead · 400+",
    );
    expect(leadTopic({ ...item, category: null, properties: null, plan: null, website: null, enquiredOn: null })).toBe(
      "",
    );
  });

  it("truncates so the topic line stays a line", () => {
    const topic = leadTopic({ ...item, website: "x".repeat(400) });
    expect(topic.length).toBeLessThanOrEqual(200);
    expect(topic.endsWith("…")).toBe(true);
  });
});

describe("outcomeFromRpcError", () => {
  it("names the cases the RPC raises with a prefix", () => {
    expect(outcomeFromRpcError("phone_conflict: +447000000000 is already on another account")).toBe("phone_conflict");
    expect(outcomeFromRpcError("email_conflict: an account already exists for a@b.com")).toBe("email_conflict");
    expect(outcomeFromRpcError("bad_phone: 07 is not a UK mobile in E.164")).toBe("bad_phone");
    expect(outcomeFromRpcError("only Stayful admins can import lead customers")).toBe("error");
    expect(outcomeFromRpcError(null)).toBe("error");
  });
});
