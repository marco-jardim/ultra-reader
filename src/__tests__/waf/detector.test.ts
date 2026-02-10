import { describe, it, expect } from "vitest";
import { detectWaf, formatWafChallengeType } from "../../waf/detector.js";

describe("detectWaf", () => {
  it("detects Cloudflare from headers + html markers", () => {
    const waf = detectWaf({
      statusCode: 403,
      headers: { "cf-ray": "abc", server: "cloudflare" },
      html: "<html>Just a moment... /cdn-cgi/challenge-platform/</html>",
    });
    expect(waf?.provider).toBe("cloudflare");
    expect(waf?.category).toBe("challenge");
    expect(formatWafChallengeType(waf!)).toBe("cloudflare");
  });

  it("detects Akamai from cookies + html markers", () => {
    const waf = detectWaf({
      statusCode: 403,
      headers: { "set-cookie": "ak_bmsc=1; bm_sz=2", server: "AkamaiGHost" },
      html: "<html>Access Denied Reference #12345</html>",
    });
    expect(waf?.provider).toBe("akamai");
    expect(formatWafChallengeType(waf!)).toContain("waf:akamai");
  });

  it("returns null for normal pages", () => {
    const waf = detectWaf({
      statusCode: 200,
      headers: { "content-type": "text/html" },
      html: "<html><body>Hello</body></html>",
    });
    expect(waf).toBeNull();
  });
});
