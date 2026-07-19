import { describe, it, expect } from "vitest";
import { isAllowedExternalUrl } from "../src/main/url-allowlist.js";

describe("isAllowedExternalUrl", () => {
  it("allows http, https, and obsidian URLs", () => {
    expect(isAllowedExternalUrl("http://example.com")).toBe(true);
    expect(isAllowedExternalUrl("https://example.com/path?q=1")).toBe(true);
    expect(isAllowedExternalUrl("obsidian://open?path=C%3A%2FMods%2Fmy-mod")).toBe(true);
  });

  it("normalizes uppercase schemes (relies on URL parsing, not prefix matching)", () => {
    expect(isAllowedExternalUrl("HTTPS://example.com")).toBe(true);
    expect(isAllowedExternalUrl("HTTP://example.com")).toBe(true);
    expect(isAllowedExternalUrl("Obsidian://open?path=x")).toBe(true);
  });

  it("rejects dangerous or unsupported schemes", () => {
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isAllowedExternalUrl("ftp://host/file")).toBe(false);
    expect(isAllowedExternalUrl("vbscript:msgbox")).toBe(false);
  });

  it("rejects strings that do not parse as a URL", () => {
    expect(isAllowedExternalUrl("not a url")).toBe(false);
    expect(isAllowedExternalUrl("")).toBe(false);
    expect(isAllowedExternalUrl("://missing-scheme")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isAllowedExternalUrl(null)).toBe(false);
    expect(isAllowedExternalUrl(undefined)).toBe(false);
    expect(isAllowedExternalUrl(42)).toBe(false);
    expect(isAllowedExternalUrl(true)).toBe(false);
    expect(isAllowedExternalUrl(false)).toBe(false);
    expect(isAllowedExternalUrl({})).toBe(false);
    expect(isAllowedExternalUrl(["https://example.com"])).toBe(false);
  });
});
