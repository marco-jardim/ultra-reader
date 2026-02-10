import { describe, it, expect, vi } from "vitest";

describe("createHeroConfig", () => {
  it("defaults to en-US and America/New_York when no proxy is provided", async () => {
    const { createHeroConfig } = await import("../../browser/hero-config.js");
    const config = createHeroConfig();

    expect(config.locale).toBe("en-US");
    expect(config.timezoneId).toBe("America/New_York");
    expect(config.upstreamProxyUrl).toBeUndefined();
  });

  it("derives locale/timezone from proxy url country hint", async () => {
    const { createHeroConfig } = await import("../../browser/hero-config.js");

    const proxyUrl =
      "http://customer-abc_session-hero_1_abc456_country-br:secret@geo.iproyal.com:12321";
    const config = createHeroConfig({ proxy: { url: proxyUrl } });

    expect(config.upstreamProxyUrl).toBe(proxyUrl);
    expect(config.upstreamProxyUseSystemDns).toBe(false);
    expect(config.locale).toBe("pt-BR");
    expect(config.timezoneId).toBe("America/Sao_Paulo");
  });

  it("supports geo= / cc= proxy query param hints (including UK alias)", async () => {
    const { createHeroConfig } = await import("../../browser/hero-config.js");

    const proxyUrl = "http://proxy.example:8080?geo=uk";
    const config = createHeroConfig({ proxy: { url: proxyUrl } });

    expect(config.locale).toBe("en-GB");
    expect(config.timezoneId).toBe("Europe/London");
  });

  it("can apply fingerprint rotation when explicitly enabled via env", async () => {
    vi.resetModules();
    process.env.HERO_FINGERPRINT_ROTATION = "1";
    process.env.HERO_FINGERPRINT_SEED = "hero-fp-test";

    try {
      const [{ createHeroConfig }, { getFingerprintRotator }] = await Promise.all([
        import("../../browser/hero-config.js"),
        import("../../utils/fingerprint-profiles.js"),
      ]);

      const expected = getFingerprintRotator("hero-fp-test").next();
      const config = createHeroConfig();

      expect(config.userAgent).toBe(expected.ua);
      expect(config.viewport?.width).toBe(expected.viewport.width);
      expect(config.viewport?.height).toBe(expected.viewport.height);
    } finally {
      delete process.env.HERO_FINGERPRINT_ROTATION;
      delete process.env.HERO_FINGERPRINT_SEED;
    }
  });
});
