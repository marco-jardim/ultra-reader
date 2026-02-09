import { describe, it, expect, vi } from "vitest";
import {
  extractProxyCountry,
  getGeoLocale,
  geoConsistentHeaders,
  getRandomAcceptLanguage,
} from "../../utils/geo-locale.js";

describe("extractProxyCountry", () => {
  it("returns undefined when no proxyUrl provided", () => {
    expect(extractProxyCountry()).toBeUndefined();
  });

  it("parses country-br patterns (including _country-br)", () => {
    expect(
      extractProxyCountry(
        "http://customer-abc_session-hero_1_abc456_country-br:secret@geo.iproyal.com:12321"
      )
    ).toBe("BR");

    expect(extractProxyCountry("http://user:pass_country-br@proxy.example:8080")).toBe("BR");
  });

  it("parses geo=br and cc=br patterns (case-insensitive)", () => {
    expect(extractProxyCountry("http://proxy.example:8080?geo=br")).toBe("BR");
    expect(extractProxyCountry("http://proxy.example:8080?cc=BR")).toBe("BR");
    expect(extractProxyCountry("http://proxy.example:8080?CC=de")).toBe("DE");
  });

  it("returns undefined when no supported pattern exists", () => {
    expect(extractProxyCountry("http://proxy.example:8080")).toBeUndefined();
  });
});

describe("getGeoLocale", () => {
  it("returns mapped locale/timezone for known country", () => {
    const br = getGeoLocale("br");
    expect(br.countryCode).toBe("BR");
    expect(br.locale).toBe("pt-BR");
    expect(br.timeZone).toBe("America/Sao_Paulo");
    expect(br.acceptLanguages.length).toBeGreaterThan(0);
  });

  it("falls back to US for unknown country", () => {
    const unknown = getGeoLocale("zz");
    expect(unknown.countryCode).toBe("US");
    expect(unknown.locale).toBe("en-US");
  });

  it("treats UK as alias for GB", () => {
    const uk = getGeoLocale("uk");
    expect(uk.countryCode).toBe("GB");
    expect(uk.locale).toBe("en-GB");
  });
});

describe("getRandomAcceptLanguage", () => {
  it("returns a plausible string and varies by locale", () => {
    const first = vi.spyOn(Math, "random").mockReturnValue(0);
    const a = getRandomAcceptLanguage("pt-BR");
    expect(a).toContain("pt-BR");

    first.mockReturnValue(0.999);
    const b = getRandomAcceptLanguage("pt-BR");
    expect(b).toContain("pt-BR");

    // With multiple candidates, first and last should differ
    expect(a).not.toBe(b);
    first.mockRestore();
  });

  it("falls back to en-US when locale is missing/unknown", () => {
    const al = getRandomAcceptLanguage("xx-YY");
    expect(al).toContain("en");
  });
});

describe("geoConsistentHeaders", () => {
  it("generates Accept-Language consistent with extracted proxy country", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const headers = geoConsistentHeaders(
      "http://customer-abc_session-hero_1_abc456_country-de:secret@geo.iproyal.com:12321"
    );
    expect(headers["Accept-Language"]).toContain("de-DE");
    vi.restoreAllMocks();
  });

  it("falls back to en-US when proxy has no geo hint", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const headers = geoConsistentHeaders("http://proxy.example:8080");
    expect(headers["Accept-Language"]).toContain("en-US");
    vi.restoreAllMocks();
  });
});
