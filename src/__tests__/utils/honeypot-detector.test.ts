import { describe, it, expect } from "vitest";
import { assessHoneypotLink } from "../../utils/honeypot-detector.js";

function makeAnchor(attrs: Record<string, string | null>, textContent: string = "") {
  return {
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    textContent,
  };
}

describe("honeypot-detector", () => {
  it("allows a normal visible content link", () => {
    const anchor = makeAnchor({}, "Read more");
    const res = assessHoneypotLink({
      href: "/posts/1",
      resolvedUrl: "https://example.com/posts/1",
      anchor,
      baseUrl: "https://example.com/",
    });
    expect(res.blocked).toBe(false);
    expect(res.score).toBeLessThan(res.threshold);
  });

  it("blocks a clearly hidden action link (display:none + /logout)", () => {
    const anchor = makeAnchor({ style: "display:none" }, "");
    const res = assessHoneypotLink({
      href: "/logout?next=/",
      resolvedUrl: "https://example.com/logout?next=/",
      anchor,
      baseUrl: "https://example.com/",
    });
    expect(res.blocked).toBe(true);
    expect(res.reasons).toContain("anchor:invisible-style");
    expect(res.reasons).toContain("url:high-confidence-action");
  });

  it("blocks a 1x1 pixel link pointing at an action-ish URL", () => {
    const anchor = makeAnchor({ style: "width:1px;height:1px;overflow:hidden" }, "");
    const res = assessHoneypotLink({
      href: "/delete-account",
      resolvedUrl: "https://example.com/delete-account",
      anchor,
      baseUrl: "https://example.com/",
    });
    expect(res.blocked).toBe(true);
    expect(res.reasons).toContain("anchor:tiny-box");
  });

  it("allows a visible logout link when no other trap signals are present", () => {
    const anchor = makeAnchor({}, "Log out");
    const res = assessHoneypotLink({
      href: "/logout",
      resolvedUrl: "https://example.com/logout",
      anchor,
      baseUrl: "https://example.com/",
    });
    // Still treated as risky at URL-level, but threshold requires multiple signals.
    expect(res.blocked).toBe(false);
    expect(res.reasons).toContain("url:high-confidence-action");
  });

  it("allows common screen-reader-only patterns without additional signals", () => {
    const anchor = makeAnchor(
      { class: "sr-only", style: "position:absolute;left:-9999px;top:auto" },
      "Skip to content"
    );
    const res = assessHoneypotLink({
      href: "/accessibility",
      resolvedUrl: "https://example.com/accessibility",
      anchor,
      baseUrl: "https://example.com/",
    });
    expect(res.blocked).toBe(false);
  });

  it("blocks a URL with very long query + repeated params + deep subdomain", () => {
    const longValue = "a".repeat(600);
    const res = assessHoneypotLink({
      href: "/p",
      resolvedUrl: `https://a.b.c.d.example.com/p?x=1&x=2&x=3&x=4&payload=${longValue}`,
      baseUrl: "https://example.com/",
    });
    expect(res.blocked).toBe(true);
    expect(res.reasons).toContain("url:very-long-query");
    expect(res.reasons).toContain("url:repeated-params");
    expect(res.reasons).toContain("url:weird-subdomain");
  });
});
