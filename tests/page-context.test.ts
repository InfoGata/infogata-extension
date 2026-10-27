import { describe, expect, it } from "vitest";
import { looksAnubisChallenged, pageContextHostFor } from "../src/page-context";

describe("pageContextHostFor", () => {
  const options = { pageContextPatterns: ["https://twstalker.com/*"] };

  it("nominates the host a declared pattern pins to", () => {
    expect(pageContextHostFor("https://twstalker.com/elonmusk", options)).toBe(
      "twstalker.com"
    );
  });

  it("ignores a url on a different host", () => {
    expect(pageContextHostFor("https://example.com/elonmusk", options)).toBe(
      undefined
    );
  });

  it("does not let a lookalike host borrow the pattern", () => {
    expect(
      pageContextHostFor("https://twstalker.com.evil.test/x", options)
    ).toBe(undefined);
  });

  it("refuses a wildcard host, which would nominate any site", () => {
    for (const pattern of ["https://*/*", "https://*.com/*"]) {
      expect(
        pageContextHostFor("https://twstalker.com/x", {
          pageContextPatterns: [pattern],
        })
      ).toBe(undefined);
    }
  });

  it("is undefined when the plugin declared nothing", () => {
    expect(pageContextHostFor("https://twstalker.com/x")).toBe(undefined);
    expect(
      pageContextHostFor("https://twstalker.com/x", { pageContextPatterns: [] })
    ).toBe(undefined);
  });

  it("does not treat siteMatch patterns as page-context nominations", () => {
    expect(
      pageContextHostFor("https://twstalker.com/x", {
        siteMatchPatterns: ["https://twstalker.com/*"],
      })
    ).toBe(undefined);
  });
});

describe("looksAnubisChallenged", () => {
  const response = (body: string) => ({
    status: 200,
    statusText: "OK",
    headers: {},
    body,
  });

  it("spots the proof-of-work page, which lobste.rs serves as a 200", () => {
    expect(
      looksAnubisChallenged(
        response(
          '<title>Making sure you&#39;re not a bot!</title>' +
            '<script id="anubis_challenge" type="application/json">{}</script>'
        )
      )
    ).toBe(true);
  });

  it("passes the real page", () => {
    expect(
      looksAnubisChallenged(response('<li data-shortid="abc123">story</li>'))
    ).toBe(false);
  });
});
