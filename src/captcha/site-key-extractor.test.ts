import { describe, expect, test } from "vitest";
import { extractFirstSiteKey, extractSiteKeyCandidates } from "./site-key-extractor";

describe("site-key-extractor", () => {
  test("extracts Turnstile sitekey from data-sitekey", () => {
    const html = `<div class="cf-turnstile" data-sitekey="0x4AAAAAAABBBBBB"></div>`;
    expect(extractFirstSiteKey(html, "turnstile")).toBe("0x4AAAAAAABBBBBB");
  });

  test("extracts Turnstile sitekey from turnstile.render", () => {
    const html = `<script>turnstile.render('#t', { sitekey: '0x4AAAAAAACCCCCC', theme: 'light' });</script>`;
    expect(extractFirstSiteKey(html, "turnstile")).toBe("0x4AAAAAAACCCCCC");
  });

  test("extracts reCAPTCHA sitekey from g-recaptcha data-sitekey", () => {
    const html = `<div class="g-recaptcha" data-sitekey="6LcAAAAA111111"></div>`;
    expect(extractFirstSiteKey(html, "recaptcha")).toBe("6LcAAAAA111111");
  });

  test("extracts reCAPTCHA sitekey from grecaptcha.render", () => {
    const html = `<script>grecaptcha.render('recap', {sitekey:"6LcBBBBB222222"});</script>`;
    expect(extractFirstSiteKey(html, "recaptcha")).toBe("6LcBBBBB222222");
  });

  test("dedupes candidates", () => {
    const html = `
      <div class="cf-turnstile" data-sitekey="0x4AAAAAAADDDDDD"></div>
      <script>turnstile.render('#t', { sitekey: '0x4AAAAAAADDDDDD' });</script>
    `;
    const candidates = extractSiteKeyCandidates(html).filter((c) => c.type === "turnstile");
    expect(candidates.map((c) => c.siteKey)).toEqual(["0x4AAAAAAADDDDDD"]);
  });
});
