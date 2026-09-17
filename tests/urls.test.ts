import { describe, expect, it } from "vitest";
import { hostLabel, isPrivateAddress, safeHttpUrl } from "@/lib/urls";

describe("safeHttpUrl", () => {
  it("accepts ordinary http and https links", () => {
    expect(safeHttpUrl("https://www.notion.so/a/page")?.hostname).toBe("www.notion.so");
    expect(safeHttpUrl("http://example.com")?.hostname).toBe("example.com");
  });

  it("accepts an uppercase scheme, which URL normalises", () => {
    expect(safeHttpUrl("HTTPS://EXAMPLE.COM/x")?.protocol).toBe("https:");
  });

  it("trims surrounding whitespace", () => {
    expect(safeHttpUrl("  https://example.com  ")?.hostname).toBe("example.com");
  });

  it("rejects schemes that are not http(s)", () => {
    for (const raw of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com",
      "mailto:someone@example.com",
    ]) {
      expect(safeHttpUrl(raw), raw).toBeNull();
    }
  });

  it("rejects loopback and internal hostnames, so the server cannot be pointed inwards", () => {
    for (const raw of [
      "http://localhost",
      "http://localhost:3000/x",
      "http://app.localhost",
      "http://printer.local",
      "https://vault.internal/secrets",
    ]) {
      expect(safeHttpUrl(raw), raw).toBeNull();
    }
  });

  it("rejects bare IP literals, v4 and v6", () => {
    for (const raw of [
      "http://127.0.0.1",
      "http://10.0.0.1/admin",
      "http://169.254.169.254/latest/meta-data",
      "http://192.168.1.1",
      "http://[::1]/",
      "http://[fd00::1]/",
    ]) {
      expect(safeHttpUrl(raw), raw).toBeNull();
    }
  });

  it("rejects anything that is not a URL at all", () => {
    for (const raw of ["", "   ", "not a url", "example.com", "//example.com"]) {
      expect(safeHttpUrl(raw), raw).toBeNull();
    }
  });
});

describe("isPrivateAddress", () => {
  it("blocks the ranges that live inside a network", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "0.0.0.0",
      "100.64.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("blocks the cloud metadata address, which is the whole point", () => {
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("169.254.0.1")).toBe(true);
  });

  it("blocks private IPv6, including v4 wearing a v6 hat", () => {
    for (const ip of [
      "::",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::127.0.0.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "192.167.1.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("treats anything it cannot parse as private, never as safe", () => {
    for (const ip of ["", "   ", "not-an-ip", "1.2.3", "1.2.3.4.5", "999.1.1.1", "12345::"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  // The bug this exists for: the hostname is not an IP literal and does not end in a blocked
  // suffix, so safeHttpUrl passes it — the address behind it is what has to be judged.
  it("is the check safeHttpUrl cannot make on its own", () => {
    expect(safeHttpUrl("http://169.254.169.254.nip.io/")).not.toBeNull();
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
  });
});

describe("hostLabel", () => {
  it("drops a www prefix", () => {
    expect(hostLabel(new URL("https://www.notion.so/x"))).toBe("notion.so");
  });

  it("leaves other subdomains alone", () => {
    expect(hostLabel(new URL("https://docs.google.com/x"))).toBe("docs.google.com");
  });

  it("is case-insensitive about the prefix", () => {
    expect(hostLabel(new URL("https://WWW.Example.COM/"))).toBe("example.com");
  });
});
