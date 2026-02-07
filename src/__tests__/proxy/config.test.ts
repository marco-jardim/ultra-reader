import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProxyUrl, parseProxyUrl } from "../../proxy/config.js";
import type { ProxyConfig } from "../../types.js";

describe("createProxyUrl", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns url directly when url field is set", () => {
    const config: ProxyConfig = {
      url: "http://user:pass@myproxy.com:8080",
    };

    expect(createProxyUrl(config)).toBe("http://user:pass@myproxy.com:8080");
  });

  it("returns url directly even if other fields are also set", () => {
    const config: ProxyConfig = {
      url: "http://direct-url.com:9090",
      type: "datacenter",
      username: "ignored",
      password: "ignored",
      host: "ignored.com",
      port: 1234,
    };

    expect(createProxyUrl(config)).toBe("http://direct-url.com:9090");
  });

  it("builds datacenter proxy URL from components", () => {
    const config: ProxyConfig = {
      type: "datacenter",
      username: "user",
      password: "pass",
      host: "proxy.example.com",
      port: 8080,
    };

    expect(createProxyUrl(config)).toBe("http://user:pass@proxy.example.com:8080");
  });

  it("builds residential proxy URL with session ID and default country", () => {
    const config: ProxyConfig = {
      type: "residential",
      username: "abc",
      password: "secret",
      host: "geo.iproyal.com",
      port: 12321,
    };

    const url = createProxyUrl(config);

    // With mocked Date.now()=1700000000000 and Math.random()=0.123456789
    // Math.random().toString(36) = "0.4fzzzxjylrx" → slice(2,8) = "4fzzzx"
    const expectedSessionId = `hero_1700000000000_${(0.123456789).toString(36).slice(2, 8)}`;

    expect(url).toBe(
      `http://customer-abc_session-${expectedSessionId}_country-us:secret@geo.iproyal.com:12321`
    );
    expect(url).toContain("_country-us");
  });

  it("builds residential proxy URL with specified country", () => {
    const config: ProxyConfig = {
      type: "residential",
      username: "abc",
      password: "secret",
      host: "geo.iproyal.com",
      port: 12321,
      country: "uk",
    };

    const url = createProxyUrl(config);

    expect(url).toContain("_country-uk:");
    expect(url).not.toContain("_country-us");
  });

  it("generates unique session IDs per call (unmocked)", () => {
    vi.restoreAllMocks(); // use real Date.now and Math.random

    const config: ProxyConfig = {
      type: "residential",
      username: "u",
      password: "p",
      host: "h.com",
      port: 1,
    };

    const url1 = createProxyUrl(config);
    const url2 = createProxyUrl(config);

    // Extract session IDs from both URLs
    const sessionPattern = /session-(hero_\d+_[a-z0-9]+)/;
    const session1 = url1.match(sessionPattern)?.[1];
    const session2 = url2.match(sessionPattern)?.[1];

    expect(session1).toBeDefined();
    expect(session2).toBeDefined();
    expect(session1).not.toBe(session2);
  });

  it("session ID contains timestamp and random suffix", () => {
    const config: ProxyConfig = {
      type: "residential",
      username: "u",
      password: "p",
      host: "h.com",
      port: 1,
    };

    const url = createProxyUrl(config);
    const sessionMatch = url.match(/session-(hero_(\d+)_([a-z0-9]+))/);

    expect(sessionMatch).not.toBeNull();
    // Timestamp part should be 1700000000000 (mocked)
    expect(sessionMatch![2]).toBe("1700000000000");
    // Random part should be 6 chars
    expect(sessionMatch![3]).toHaveLength(6);
  });
});

describe("parseProxyUrl", () => {
  it("extracts username, password, host, port from a valid URL", () => {
    const result = parseProxyUrl("http://user:pass@proxy.example.com:8080");

    expect(result.username).toBe("user");
    expect(result.password).toBe("pass");
    expect(result.host).toBe("proxy.example.com");
    expect(result.port).toBe(8080);
    expect(result.url).toBe("http://user:pass@proxy.example.com:8080");
  });

  it("preserves the original URL in the url field", () => {
    const originalUrl = "http://admin:secret123@10.0.0.1:3128";
    const result = parseProxyUrl(originalUrl);

    expect(result.url).toBe(originalUrl);
  });

  it("handles URL without port", () => {
    const result = parseProxyUrl("http://user:pass@proxy.example.com");

    expect(result.username).toBe("user");
    expect(result.password).toBe("pass");
    expect(result.host).toBe("proxy.example.com");
    // port should be undefined when not specified (parseInt of empty string is NaN)
    expect(result.port).toBeUndefined();
  });

  it("handles URL without credentials", () => {
    const result = parseProxyUrl("http://proxy.example.com:8080");

    expect(result.username).toBe("");
    expect(result.password).toBe("");
    expect(result.host).toBe("proxy.example.com");
    expect(result.port).toBe(8080);
  });

  it("handles special characters in password (URL-encoded)", () => {
    const result = parseProxyUrl("http://user:p%40ss%23word@proxy.com:8080");

    expect(result.username).toBe("user");
    // URL.password returns percent-encoded value (not decoded)
    expect(result.password).toBe("p%40ss%23word");
    expect(result.host).toBe("proxy.com");
  });

  it("handles IP address as host", () => {
    const result = parseProxyUrl("http://admin:pass@192.168.1.100:3128");

    expect(result.host).toBe("192.168.1.100");
    expect(result.port).toBe(3128);
  });

  it("throws Error for invalid URL", () => {
    expect(() => parseProxyUrl("not-a-url")).toThrow(Error);
    expect(() => parseProxyUrl("not-a-url")).toThrow("Invalid proxy URL: not-a-url");
  });

  it("throws Error for empty string", () => {
    expect(() => parseProxyUrl("")).toThrow("Invalid proxy URL: ");
  });

  it("handles socks5 protocol", () => {
    const result = parseProxyUrl("socks5://user:pass@proxy.com:1080");

    expect(result.username).toBe("user");
    expect(result.password).toBe("pass");
    expect(result.host).toBe("proxy.com");
    expect(result.port).toBe(1080);
  });
});
